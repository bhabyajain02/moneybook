"""
MoneyBook — WhatsApp Webhook Server
=====================================
FastAPI + Twilio webhook with a full conversation state machine.

Conversation States:
  idle              → ready for new input
  confirming        → parsed transactions shown, waiting for haan/galat/cancel
  correcting        → user said "galat N", waiting for corrected entry
  classifying       → asking owner to classify a person (staff/customer/supplier/home)

Run:
    uvicorn execution.moneybook_webhook:app --reload --port 8000
"""

import os
import sys
import uuid
import json
import logging
from datetime import date, timedelta
from typing import Optional

from fastapi import FastAPI, Form, BackgroundTasks, UploadFile, File, HTTPException, Request, Body
from fastapi.responses import PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from twilio.rest import Client as TwilioClient
from twilio.twiml.messaging_response import MessagingResponse
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from pathlib import Path

# Load .env from project root regardless of working directory
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env', override=False)

sys.path.insert(0, os.path.dirname(__file__))

from moneybook_db import (
    init_db, migrate_fix_negative_udhaar, migrate_backfill_dues_person_name,
    migrate_clean_dues_given_names, _extract_name_from_desc,
    get_or_create_store, get_store_by_phone, update_store, get_all_active_stores,
    get_bot_state, set_bot_state, clear_bot_state,
    add_transaction,
    get_person, save_person, get_unknown_persons,
    get_daily_summary, get_period_summary, get_udhaar_outstanding,
    get_udhaar_aging, get_weekly_summary,
    save_correction, build_store_context,
    get_store_segment, promote_correction,
    save_web_message, get_web_messages, clear_store_data,
    get_daily_trend, get_staff_payments, get_payment_mode_split,
    get_top_receivers, get_others_summary, get_dues_with_detail, get_dues_received, get_staff_detail,
    get_supplier_detail, get_others_detail, get_others_grouped,
    get_store_expense_tags,
    update_udhaar_contact,
    update_message_metadata, delete_transaction,
    get_person_udhaar_history,
    add_to_operator_queue, get_operator_queue, update_queue_status,
    save_shadow_parse, get_shadow_parse_for_queue, complete_queue_item,
    get_store_ai_config, update_store_ai_config,
    verify_operator, get_operator_by_id, list_operators,
    get_descriptions_by_type, get_tags_by_type,
)
from moneybook_parser import (
    parse_text_message, parse_image_message, parse_correction,
    classify_correction_scope, is_trackable_person,
    format_pending_confirmation, format_person_question,
    format_daily_summary, format_period_summary, format_udhaar_list,
    TAG_META, check_image_quality,
)
from moneybook_eval import compute_accuracy, update_store_learning
from execution.translations import t as bt

TWILIO_ACCOUNT_SID     = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN      = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_WHATSAPP_NUMBER = os.getenv('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+14155238886')

twilio = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('moneybook')

app = FastAPI(title='MoneyBook', version='2.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PERSON_CATEGORIES = {
    '1': 'staff',
    '2': 'customer',
    '3': 'supplier',
    '4': 'home',
}

# Business segment choices during onboarding
SEGMENT_CHOICES = {
    '1': 'textile',
    '2': 'grocery',
    '3': 'pharmacy',
    '4': 'hardware',
    '5': 'food',
    '6': 'electronics',
    '7': 'general',
}

SEGMENT_LABELS = {
    'textile':     '👗 Kapda / Textile',
    'grocery':     '🛒 Grocery / Kiryana',
    'pharmacy':    '💊 Dawai / Pharmacy',
    'hardware':    '🔧 Hardware / Tools',
    'food':        '🍱 Khana / Food/Restaurant',
    'electronics': '📱 Electronics',
    'general':     '🏪 Aur kuch / Other',
}

def get_segment_msg(lang='hinglish'):
    return bt('segment_ask', lang)

PERSON_LABELS = {
    'staff':    '👷 Staff/Employee',
    'customer': '🛒 Customer',
    'supplier': '📦 Supplier/Party',
    'home':     '🏠 Ghar ka kharcha',
}


def get_help_msg(lang='hinglish'):
    return bt('help_msg', lang)

COMMANDS = {
    '/summary': 'summary', 'summary': 'summary',
    'aaj ka hisaab': 'summary', 'aaj ka hisab': 'summary',
    '/udhaar': 'udhaar', 'udhaar': 'udhaar', 'udhaar list': 'udhaar',
    '/month': 'month', 'month': 'month', 'is mahine': 'month', 'mahina': 'month',
    '/quarter': 'quarter', 'quarter': 'quarter', 'is quarter': 'quarter',
    '/year': 'year', 'year': 'year', 'is saal': 'year', 'saal': 'year',
    '/help': 'help', 'help': 'help',
}


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def twiml_reply(text: str) -> PlainTextResponse:
    r = MessagingResponse()
    r.message(text)
    return PlainTextResponse(str(r), media_type='application/xml')


def send_whatsapp(to: str, body: str):
    """
    Send a WhatsApp message via Twilio REST API.
    Twilio hard limit: 1600 chars per message.
    If body exceeds limit, split at line boundaries into multiple messages.
    """
    LIMIT = 1500  # conservative — leave headroom for encoding

    if len(body) <= LIMIT:
        _send_single(to, body)
        return

    # Split on double-newlines (between entries) keeping chunks under LIMIT
    lines  = body.split('\n')
    chunks = []
    current = []
    current_len = 0

    for line in lines:
        # +1 for the newline we'll rejoin with
        if current_len + len(line) + 1 > LIMIT and current:
            chunks.append('\n'.join(current))
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len += len(line) + 1

    if current:
        chunks.append('\n'.join(current))

    for i, chunk in enumerate(chunks, 1):
        prefix = f'_(Part {i}/{len(chunks)})_\n' if len(chunks) > 1 else ''
        _send_single(to, prefix + chunk)


def _send_single(to: str, body: str):
    try:
        twilio.messages.create(from_=TWILIO_WHATSAPP_NUMBER, to=to, body=body)
    except Exception as e:
        log.error(f"Twilio send error ({to}): {e}")


def detect_command(text: str) -> Optional[str]:
    t = text.lower().strip()
    for trigger, action in COMMANDS.items():
        if t == trigger or t.startswith(trigger + ' '):
            return action
    return None


def run_command(action: str, store: dict) -> str:
    from datetime import date as dt
    sid  = store['id']
    name = store.get('name', 'Store')

    if action == 'summary':
        return format_daily_summary(get_daily_summary(sid), name)

    if action == 'udhaar':
        return format_udhaar_list(get_udhaar_outstanding(sid))

    if action == 'month':
        today = dt.today()
        start = today.replace(day=1).isoformat()
        end   = today.isoformat()
        month_name = today.strftime('%B %Y')
        data  = get_period_summary(sid, start, end, label=month_name)
        return format_period_summary(data, name)

    if action == 'quarter':
        today = dt.today()
        q_start_month = ((today.month - 1) // 3) * 3 + 1
        start = today.replace(month=q_start_month, day=1).isoformat()
        end   = today.isoformat()
        q_num = (today.month - 1) // 3 + 1
        data  = get_period_summary(sid, start, end, label=f'Q{q_num} {today.year}')
        return format_period_summary(data, name)

    if action == 'year':
        today = dt.today()
        start = today.replace(month=1, day=1).isoformat()
        end   = today.isoformat()
        data  = get_period_summary(sid, start, end, label=f'Year {today.year}')
        return format_period_summary(data, name)

    return get_help_msg(store.get('language', 'hinglish'))


def save_confirmed_batch(store_id: int, transactions: list,
                         raw_message: str, source: str, persons_map: dict):
    """Save all confirmed transactions. Apply known person categories."""
    for txn in transactions:
        pname = txn.get('person_name')
        if pname and pname in persons_map:
            txn['person_category'] = persons_map[pname]
        add_transaction(store_id, txn, raw_message=raw_message, source=source)


def next_person_to_classify(store_id: int, persons_found: list) -> Optional[str]:
    """Return next unclassified person name from the list."""
    for name in persons_found:
        if name and not get_person(store_id, name):
            return name
    return None


# ─────────────────────────────────────────────
# State: CONFIRMING
# Owner sees the parsed list and responds
# ─────────────────────────────────────────────

def handle_confirming(body: str, store: dict, state: dict) -> str:
    """Handle response when bot is in 'confirming' state."""
    sid      = store['id']
    language = store.get('language', 'hinglish')
    t        = body.strip().lower()

    pending      = state.get('pending', [])
    raw_message  = state.get('raw_message', '')
    source       = state.get('source', 'text')
    persons_found = state.get('persons_found', [])
    page_date    = state.get('page_date')
    persons_map  = state.get('persons_map', {})

    # ── Cancel ──────────────────────────────────────
    if t == 'cancel':
        clear_bot_state(sid)
        return bt('confirm_cancel', language)

    # ── Haan = save all ─────────────────────────────
    if t in ('haan', 'han', 'yes', 'ok', 'okay', 'sahi', '✅', 'haan sahi'):
        save_confirmed_batch(sid, pending, raw_message, source, persons_map)

        # Check if any persons need classification (only those with needs_tracking=True)
        candidates_wa = [
            p.get('person_name') for p in pending
            if p.get('person_name') and p.get('needs_tracking', True)
        ]
        unknown_candidates_wa = get_unknown_persons(sid, [p for p in candidates_wa if p])

        # Use Haiku to confirm each unknown is actually a real trackable person
        trackable_persons = []
        for name in unknown_candidates_wa:
            txn = next((t for t in pending if t.get('person_name') == name), {})
            if is_trackable_person(
                name=name,
                description=txn.get('description', ''),
                txn_type=txn.get('type', ''),
                amount=txn.get('amount', 0),
            ):
                trackable_persons.append(name)
        unknown = trackable_persons
        if unknown:
            next_person = unknown[0]
            # Build person classification prompt for the first unknown
            txn_for_person = next(
                (t for t in pending if t.get('person_name') == next_person), {}
            )
            set_bot_state(sid, {
                'state':          'classifying',
                'persons_queue':  unknown,
                'person_index':   0,
                'persons_map':    persons_map,
            })
            amt  = txn_for_person.get('amount', 0)
            desc = txn_for_person.get('description', '')
            return (
                bt('confirm_saved', language, count=len(pending))
                + "\n\n" + format_person_question(next_person, float(amt), desc)
            )
        else:
            clear_bot_state(sid)
            return bt('confirm_saved', language, count=len(pending))

    # ── Galat N = fix entry N ────────────────────────
    import re
    m = re.match(r'^galat\s+(\d+)$', t)
    if not m:
        m = re.match(r'^(\d+)\s+galat$', t)
    if m:
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(pending):
            entry = pending[idx]
            set_bot_state(sid, {
                **state,
                'state':           'correcting',
                'correcting_index': idx,
            })
            tag   = entry.get('tag', 'other')
            emoji = TAG_META.get(tag, ('', '📝'))[1]
            return bt('correction_prompt', language,
                       idx=idx+1,
                       desc=entry.get('description', ''),
                       amount=f"{float(entry['amount']):,.0f}",
                       emoji=emoji)
        else:
            return bt('entry_not_found', language, idx=idx+1, total=len(pending))

    # ── Tag change: "3 tag electricity" ────────────
    m_tag = re.match(r'^(\d+)\s+tag\s+(\w+)$', t)
    if m_tag:
        idx     = int(m_tag.group(1)) - 1
        new_tag = m_tag.group(2)
        if 0 <= idx < len(pending) and new_tag in TAG_META:
            pending[idx]['tag'] = new_tag
            set_bot_state(sid, {**state, 'pending': pending})
            emoji = TAG_META[new_tag][1]
            label = TAG_META[new_tag][0]
            return (
                f"🏷️ Entry {idx+1} ka tag update hua: {emoji} _{label}_\n\n"
                + format_pending_confirmation(pending, page_date)
            )
        else:
            tag_list = ', '.join(TAG_META.keys())
            return f"Tag '{new_tag}' nahi mila.\nAvailable tags:\n{tag_list}"

    # ── Unrecognized ────────────────────────────────
    return (
        bt('confirm_help', language)
        + format_pending_confirmation(pending, page_date)
    )


# ─────────────────────────────────────────────
# State: CORRECTING
# Owner is providing the corrected info for entry N
# ─────────────────────────────────────────────

def handle_correcting(body: str, store: dict, state: dict) -> str:
    """
    Apply correction to the pending entry, classify its scope, save for 3-tier learning.

    Scope classification:
      global  → benefits all stores (UPI spelling, common abbreviations)
      segment → benefits same-industry stores (textile vocab, pharmacy terms)
      store   → private to this store (person names, local shorthand)
    """
    sid     = store['id']
    idx     = state.get('correcting_index', 0)
    pending = state.get('pending', [])

    original  = pending[idx]
    corrected = parse_correction(original, body)
    pending[idx] = corrected

    # ── Classify correction scope (Haiku call, ~500ms) ──
    store_segment = get_store_segment(sid)
    scope = classify_correction_scope(original, corrected, store_segment)

    # ── Save with scope for 3-tier learning ─────────────
    save_correction(
        store_id       = sid,
        raw_text       = state.get('raw_ocr', state.get('raw_message', '')),
        original_json  = original,
        corrected_json = corrected,
        entry_index    = idx + 1,
        scope          = scope,
        segment        = store_segment if scope == 'segment' else None,
    )

    # ── Promote if multiple stores made the same correction ──
    if scope in ('segment', 'global'):
        promote_correction(sid, corrected,
                           target_scope=scope,
                           target_segment=store_segment if scope == 'segment' else None)

    scope_emoji = {'global': '🌐', 'segment': '🏪', 'store': '🔒'}.get(scope, '🔒')
    scope_label = {'global': 'sabhi stores ke liye',
                   'segment': f'{store_segment} stores ke liye',
                   'store':   'sirf aapke store ke liye'}.get(scope, '')
    log.info(f"Correction saved store={sid} entry={idx+1} scope={scope} segment={store_segment}")

    new_state = {**state, 'state': 'confirming', 'pending': pending}
    new_state.pop('correcting_index', None)
    set_bot_state(sid, new_state)

    tag   = corrected.get('tag', 'other')
    emoji = TAG_META.get(tag, ('', '📝'))[1]
    return (
        f"✅ Entry {idx+1} update ho gayi:\n"
        f"_{corrected.get('description','')} — ₹{float(corrected['amount']):,.0f} "
        f"{emoji}_\n\n"
        f"_{scope_emoji} Seekh liya ({scope_label}) — agli baar se sahi karunga_ 🧠\n\n"
        + format_pending_confirmation(pending, state.get('page_date'))
    )


# ─────────────────────────────────────────────
# State: CLASSIFYING
# Owner classifies a person (staff/customer/etc.)
# ─────────────────────────────────────────────

def handle_classifying(body: str, store: dict, state: dict) -> str:
    """Process person category choice and advance to next person or finish."""
    sid      = store['id']
    language = store.get('language', 'hinglish')
    queue    = state.get('persons_queue', [])
    idx      = state.get('person_index', 0)

    choice = body.strip()
    if choice not in PERSON_CATEGORIES:
        names = '\n'.join([f"{k}️⃣ {v}" for k, v in PERSON_LABELS.items()])
        return f"Please 1, 2, 3, ya 4 mein se choose karein:\n{names}"

    category  = PERSON_CATEGORIES[choice]
    name      = queue[idx]
    save_person(sid, name, category)

    label = PERSON_LABELS[category]
    response = f"✅ *{name}* → {label}\n\n"

    # Advance to next unknown person
    idx += 1
    unknown_remaining = [n for n in queue[idx:] if not get_person(sid, n)]

    if unknown_remaining:
        next_name = unknown_remaining[0]
        next_idx  = queue.index(next_name)
        set_bot_state(sid, {**state, 'person_index': next_idx})
        return response + format_person_question(next_name, 0, '')
    else:
        clear_bot_state(sid)
        return response + bt('person_classify_done', language)


# ─────────────────────────────────────────────
# Main webhook
# ─────────────────────────────────────────────

def process_image_and_reply(from_number: str, media_url: str, body: str):
    """
    Background task: download + parse image, then push reply via REST API.
    This runs AFTER the webhook has already returned 200 to Twilio,
    so we are not constrained by the 15-second webhook timeout.
    """
    try:
        store    = get_or_create_store(from_number)
        sid      = store['id']
        language = store.get('language', 'hinglish')

        ctx           = build_store_context(sid)   # per-store learning context
        etags         = [t['tag'] for t in get_store_expense_tags(sid, limit=15)]
        parsed        = parse_image_message(media_url, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
                                            store_context=ctx, existing_tags=etags)
        txns          = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
        persons_found = parsed.get('persons_found', [])
        page_date     = parsed.get('date')
        raw_ocr       = parsed.get('raw_ocr', '')

        if not txns:
            # If low confidence, show raw OCR so owner can verify what was read
            ocr_conf = parsed.get('ocr_confidence', 'high')
            if raw_ocr and ocr_conf in ('low', 'medium'):
                reply = bt('photo_ocr_fail', language, ocr=raw_ocr[:400])
            else:
                reply = (parsed.get('response_message') or
                         bt('photo_empty', language))
        else:
            set_bot_state(sid, {
                'state':         'confirming',
                'pending':       txns,
                'persons_found': persons_found,
                'persons_map':   {},
                'raw_message':   body,
                'source':        'image',
                'page_date':     page_date,
                'raw_ocr':       raw_ocr,     # stored for correction learning
            })
            reply = format_pending_confirmation(txns, page_date)

        send_whatsapp(from_number, reply)
        log.info(f"Image processed for {from_number}: {len(txns)} transactions found")
    except Exception as e:
        log.error(f"Background image processing failed: {e}")
        send_whatsapp(from_number, f"⚠️ Photo process karne mein error: {str(e)[:100]}")


@app.post('/whatsapp')
async def whatsapp_webhook(
    background_tasks: BackgroundTasks,
    From:               str = Form(...),
    Body:               str = Form(default=''),
    NumMedia:           int = Form(default=0),
    MediaUrl0:          str = Form(default=None),
    MediaContentType0:  str = Form(default=None),
):
    from_number = From
    body        = Body.strip()
    has_media   = NumMedia > 0 and MediaUrl0

    log.info(f"▶ {from_number} | media={has_media} | '{body[:60]}'")

    store    = get_or_create_store(from_number)
    sid      = store['id']
    language = store.get('language', 'hinglish')

    # ── Onboarding ───────────────────────────────────────
    if store['onboarding_state'] == 'new':
        update_store(sid, onboarding_state='awaiting_name')
        return twiml_reply(bt('welcome', language))

    if store['onboarding_state'] == 'awaiting_name':
        name = body or 'My Store'
        update_store(sid, name=name, onboarding_state='awaiting_segment')
        return twiml_reply(bt('store_name_set', language, name=name) + get_segment_msg(language))

    if store['onboarding_state'] == 'awaiting_segment':
        choice  = body.strip()
        segment = SEGMENT_CHOICES.get(choice, 'general')
        label   = SEGMENT_LABELS[segment]
        update_store(sid, segment=segment, onboarding_state='active')
        return twiml_reply(
            bt('segment_set', language, label=label)
            + get_help_msg(language)
        )

    # ── Image: respond instantly, process in background ──
    # Twilio has a 15-second webhook timeout. Image download + Gemini Vision
    # takes 20-30s, so we must return immediately and push the reply later.
    if has_media:
        background_tasks.add_task(process_image_and_reply, from_number, MediaUrl0, body)
        return twiml_reply(bt('photo_processing', language))

    # ── Conversation state machine (text only below) ─────
    bot_state = get_bot_state(sid)
    current   = bot_state.get('state', 'idle')

    # Commands always interrupt current state
    if detect_command(body) in ('help', 'summary', 'udhaar', 'month', 'quarter', 'year'):
        clear_bot_state(sid)
        return twiml_reply(run_command(detect_command(body), store))

    if current == 'confirming':
        return twiml_reply(handle_confirming(body, store, bot_state))

    if current == 'correcting':
        return twiml_reply(handle_correcting(body, store, bot_state))

    if current == 'classifying':
        return twiml_reply(handle_classifying(body, store, bot_state))

    # ── Idle: commands ───────────────────────────────────
    action = detect_command(body)
    if action:
        return twiml_reply(run_command(action, store))

    # ── Idle: parse text transaction ─────────────────────
    ctx           = build_store_context(sid)   # inject per-store learning
    parsed        = parse_text_message(body, store_context=ctx)
    txns          = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
    persons_found = parsed.get('persons_found', [])
    page_date     = parsed.get('date')

    if not txns:
        return twiml_reply(
            parsed.get('response_message') or
            bt('parse_fail', language)
        )

    # Single transaction → auto-save immediately
    if len(txns) == 1:
        t = txns[0]
        add_transaction(sid, t, raw_message=body, source='text')
        tag   = t.get('tag', 'other')
        emoji = TAG_META.get(tag, ('', '📝'))[1]
        label = TAG_META.get(tag, ('', '📝'))[0]
        reply = (f"✅ Save: {t.get('description','')} — ₹{float(t['amount']):,.0f}\n"
                 f"   {emoji} _{label}_")
        if (t.get('person_name') and t.get('needs_tracking', False)
                and not get_person(sid, t['person_name'])):
            set_bot_state(sid, {'state': 'classifying',
                                'persons_queue': [t['person_name']], 'person_index': 0})
            reply += '\n\n' + format_person_question(
                t['person_name'], float(t['amount']), t.get('description', ''))
        return twiml_reply(reply)

    # Multiple transactions → show confirmation list
    set_bot_state(sid, {
        'state': 'confirming', 'pending': txns,
        'persons_found': persons_found, 'persons_map': {},
        'raw_message': body, 'source': 'text', 'page_date': page_date,
    })
    return twiml_reply(format_pending_confirmation(txns, page_date))


# ─────────────────────────────────────────────
# Health check
# ─────────────────────────────────────────────

@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'MoneyBook v2', 'date': date.today().isoformat()}


# ─────────────────────────────────────────────
# Scheduled jobs
# ─────────────────────────────────────────────

def job_daily_summary():
    log.info("⏰ Daily summaries...")
    for store in get_all_active_stores():
        data = get_daily_summary(store['id'])
        msg  = format_daily_summary(data, store.get('name', 'Store'))
        msg += "\n\n_📒 MoneyBook Daily Report_"
        send_whatsapp(store['phone'], msg)


def job_udhaar_alerts():
    log.info("⏰ Udhaar alerts...")
    for store in get_all_active_stores():
        aging = get_udhaar_aging(store['id'], days=30)
        if not aging:
            continue
        total = sum(u['balance'] for u in aging)
        lines = [f"⚠️ *Purana Udhaar — {store.get('name','')}*\n"]
        for u in aging:
            days = (date.today() - date.fromisoformat(u['last_transaction_date'])).days
            lines.append(f"• {u['person_name']}: ₹{u['balance']:,.0f} ({days} din)")
        lines.append(f"\nTotal: ₹{total:,.0f}")
        send_whatsapp(store['phone'], '\n'.join(lines))


_scheduler = BackgroundScheduler(timezone='Asia/Kolkata')
_scheduler.add_job(job_daily_summary, 'cron', hour=21, minute=0)
_scheduler.add_job(job_udhaar_alerts, 'cron', day_of_week='mon', hour=9)


@app.on_event('startup')
def on_startup():
    # Ensure uploads directory exists
    os.makedirs(os.path.join(os.path.dirname(__file__), '..', '.tmp', 'uploads'), exist_ok=True)
    init_db()
    migrate_fix_negative_udhaar()          # Fix negative udhaar balances from wrong column usage
    migrate_backfill_dues_person_name()    # Backfill person_name on old dues_received rows
    migrate_clean_dues_given_names()       # Fix person_name/description on dues_given that had full sentence
    _scheduler.start()
    log.info("🚀 MoneyBook v2 started.")


@app.on_event('shutdown')
def on_shutdown():
    _scheduler.shutdown(wait=False)


# ─────────────────────────────────────────────────────────────
# Web App API  (/api/*)
# ─────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    phone: str        # 10 digits, no country code
    store_name: str = ''  # optional: pre-fill store name for new users

class SendMessageRequest(BaseModel):
    phone: str     # canonical form: "web:+91XXXXXXXXXX"
    body: str
    language: str = 'hinglish'

class UpdateContactRequest(BaseModel):
    phone: str
    person_name: str
    contact_phone: str

class ConfirmRequest(BaseModel):
    phone: str
    transactions: list                        # final (possibly edited) transactions
    bot_message_id: Optional[int] = None
    original_transactions: Optional[list] = None  # AI-parsed originals, for diff-based learning

class QuickParseRequest(BaseModel):
    description: str
    amount: float
    person_name: str = ''


def _normalize_phone(digits: str) -> str:
    """Convert 10-digit input to canonical web store phone.
    Handles: '9876543210', '919876543210', '+919876543210'
    """
    d = digits.replace(' ', '').replace('-', '').replace('+', '')
    # Strip leading country code '91' only if it makes the number 12 digits
    if len(d) == 12 and d.startswith('91'):
        d = d[2:]
    # Take last 10 digits to be safe
    return f"web:+91{d[-10:]}"


def _quick_replies_for_state(bot_state: dict, pending: list) -> list:
    """Return appropriate quick reply strings based on current conversation state."""
    state = bot_state.get('state', 'idle')
    if state == 'confirming':
        replies = ['haan']
        for i in range(min(len(pending), 5)):   # offer galat for first 5 entries
            replies.append(f'galat {i+1}')
        replies.append('cancel')
        return replies
    if state == 'classifying':
        return ['1', '2', '3', '4']
    return []


def _process_web_message(phone: str, body: str, language: str = 'hinglish') -> dict:
    """
    Core message processing — shared by web API and WhatsApp webhook.
    Returns dict: { reply, quick_replies, processing }
    """
    store = get_or_create_store(phone)
    sid   = store['id']
    # Use store language if available, fall back to passed-in language
    lang  = store.get('language') or language

    # ── Onboarding ────────────────────────────────────────
    if store['onboarding_state'] == 'new':
        update_store(sid, onboarding_state='awaiting_name')
        reply = bt('welcome', lang)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    if store['onboarding_state'] == 'awaiting_name':
        name = body.strip() or 'My Store'
        update_store(sid, name=name, onboarding_state='awaiting_segment')
        reply = bt('store_name_set', lang, name=name) + get_segment_msg(lang)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    if store['onboarding_state'] == 'awaiting_segment':
        choice  = body.strip()
        segment = SEGMENT_CHOICES.get(choice, 'general')
        label   = SEGMENT_LABELS[segment]
        update_store(sid, segment=segment, onboarding_state='active')
        reply = bt('segment_set', lang, label=label) + get_help_msg(lang)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    # ── Commands always interrupt state ──────────────────
    action = detect_command(body)
    if action in ('help', 'summary', 'udhaar', 'month', 'quarter', 'year'):
        clear_bot_state(sid)
        reply = run_command(action, store)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    # ── Conversation state machine ────────────────────────
    bot_state = get_bot_state(sid)
    current   = bot_state.get('state', 'idle')

    if current == 'confirming':
        reply = handle_confirming(body, store, bot_state)
        new_state = get_bot_state(sid)
        pending = new_state.get('pending', [])
        qr = _quick_replies_for_state(new_state, pending)
        # If still confirming, include pending_transactions in response
        pt = pending if new_state.get('state') == 'confirming' else None
        return {'reply': reply, 'quick_replies': qr, 'processing': False,
                'pending_transactions': pt}

    if current == 'correcting':
        reply = handle_correcting(body, store, bot_state)
        new_state = get_bot_state(sid)
        pending = new_state.get('pending', [])
        qr = _quick_replies_for_state(new_state, pending)
        return {'reply': reply, 'quick_replies': qr, 'processing': False}

    if current == 'classifying':
        # Allow cancel to escape classifying state
        if body.strip().lower() == 'cancel':
            clear_bot_state(sid)
            return {'reply': bt('classify_cancel', lang), 'quick_replies': [], 'processing': False}
        reply = handle_classifying(body, store, bot_state)
        new_state = get_bot_state(sid)
        qr = _quick_replies_for_state(new_state, new_state.get('pending', []))
        return {'reply': reply, 'quick_replies': qr, 'processing': False}

    # ── Idle: parse text transaction ─────────────────────
    ctx    = build_store_context(sid)
    etags  = [t['tag'] for t in get_store_expense_tags(sid, limit=15)]
    parsed = parse_text_message(body, store_context=ctx, language=language, existing_tags=etags)
    txns   = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
    persons_found = parsed.get('persons_found', [])
    page_date = parsed.get('date')

    if not txns:
        reply = (parsed.get('response_message') or
                 bt('parse_fail', lang))
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    if len(txns) == 1:
        t = txns[0]
        add_transaction(sid, t, raw_message=body, source='text')
        tag   = t.get('tag', 'other')
        emoji = TAG_META.get(tag, ('', '📝'))[1]
        label = TAG_META.get(tag, ((tag or 'other').replace('_',' ').title(), '📝'))[0]
        reply = f"✅ Save: {t.get('description','')} — ₹{float(t['amount']):,.0f}\n   {emoji} _{label}_"
        if (t.get('person_name') and t.get('needs_tracking', False)
                and not get_person(sid, t['person_name'])):
            set_bot_state(sid, {'state': 'classifying',
                                'persons_queue': [t['person_name']], 'person_index': 0})
            reply += '\n\n' + format_person_question(t['person_name'], float(t['amount']), t.get('description',''))
            return {'reply': reply, 'quick_replies': ['1','2','3','4'], 'processing': False,
                    'pending_transactions': [t]}
        return {'reply': reply, 'quick_replies': [], 'processing': False,
                'pending_transactions': [t]}

    # Multiple transactions → confirmation
    set_bot_state(sid, {
        'state': 'confirming', 'pending': txns,
        'persons_found': persons_found, 'persons_map': {},
        'raw_message': body, 'source': 'text', 'page_date': page_date,
    })
    reply = format_pending_confirmation(txns, page_date)
    qr = _quick_replies_for_state(get_bot_state(sid), txns)
    return {'reply': reply, 'quick_replies': qr, 'processing': False,
            'pending_transactions': txns}


@app.get('/api/check')
async def api_check_phone(phone: str):
    """Read-only: check if a phone number has an active store. Does NOT create a store."""
    normalized = _normalize_phone(phone)
    store = get_store_by_phone(normalized)
    if store and store.get('onboarding_state') == 'active' and store.get('name'):
        return {'exists': True, 'name': store['name'], 'phone': normalized}
    return {'exists': False, 'name': '', 'phone': normalized}


@app.post('/api/login')
async def api_login(req: LoginRequest):
    """Register or load a store by phone number. Returns store metadata.
    Web login always advances straight to active — no segment question needed.
    """
    phone = _normalize_phone(req.phone)
    store = get_or_create_store(phone)
    sid   = store['id']

    # If name provided: set name and go straight to active (skip segment picker)
    if req.store_name and store['onboarding_state'] in ('new', 'awaiting_name'):
        update_store(sid, name=req.store_name.strip(), onboarding_state='active')
        store = get_or_create_store(phone)

    # Existing stores stuck in awaiting_segment (no name entered yet): unblock them
    elif store['onboarding_state'] == 'awaiting_segment':
        update_store(sid, onboarding_state='active')
        store = get_or_create_store(phone)

    return {
        'phone':            phone,
        'store_id':         store['id'],
        'name':             store.get('name') or '',
        'onboarding_state': store['onboarding_state'],
        'segment':          store.get('segment', 'general'),
    }


@app.post('/api/message')
async def api_send_message(req: SendMessageRequest):
    """Process a text message. Returns bot reply + quick replies immediately."""
    store = get_or_create_store(req.phone)
    sid   = store['id']

    # Save user message
    user_msg_id = save_web_message(sid, 'user', req.body)

    # Process
    result = _process_web_message(req.phone, req.body, language=req.language)
    reply  = result['reply']
    qr     = result['quick_replies']

    # Save bot reply (with pending_transactions metadata if present)
    metadata = {'pending_transactions': result['pending_transactions']} \
               if result.get('pending_transactions') else None
    bot_msg_id = save_web_message(sid, 'bot', reply, quick_replies=qr, metadata=metadata)

    # Refresh store name after potential onboarding
    updated_store = get_or_create_store(req.phone)

    return {
        'user_message_id': user_msg_id,
        'bot_message_id':  bot_msg_id,
        'bot_reply':       reply,
        'quick_replies':   qr,
        'processing':      result['processing'],
        'store_name':      updated_store.get('name', ''),
    }


@app.post('/api/image')
async def api_send_image(
    background_tasks: BackgroundTasks,
    phone: str = Form(...),
    file: UploadFile = File(...),
    language: str = Form(default='hinglish'),
):
    """Upload a notebook image. Saves to disk, adds to operator queue, triggers shadow parse."""
    store = get_or_create_store(phone)
    sid   = store['id']

    # Auto-complete onboarding if user uploads photo before finishing
    if store.get('onboarding_state') in ('new', 'awaiting_name', 'awaiting_segment'):
        updates = {'onboarding_state': 'active'}
        if not store.get('name'):
            updates['name'] = 'My Store'
        if not store.get('segment'):
            updates['segment'] = 'general'
        update_store(sid, **updates)

    # Save file to .tmp/uploads/
    uploads_dir = Path(__file__).parent.parent / '.tmp' / 'uploads'
    uploads_dir.mkdir(parents=True, exist_ok=True)
    ext      = Path(file.filename or 'image.jpg').suffix or '.jpg'
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = uploads_dir / filename
    contents = await file.read()
    filepath.write_bytes(contents)

    media_url = f"/uploads/{filename}"

    # Image quality check
    quality_ok, quality_reason = check_image_quality(str(filepath))
    img_lang = store.get('language') or language

    if not quality_ok:
        # Bad quality — tell user to resend, don't queue
        save_web_message(sid, 'user', body=None, media_url=media_url)
        save_web_message(sid, 'bot',
                         f"⚠️ Photo quality issue ({quality_reason}). Please resend a clearer photo.")
        return {'media_url': media_url, 'quality_ok': False, 'reason': quality_reason}

    # Save user message (image)
    user_msg_id = save_web_message(sid, 'user', body=None, media_url=media_url)

    # Add to operator queue
    queue_id = add_to_operator_queue(sid, media_url, quality_ok=quality_ok)

    # Simple ack — no ConfirmCard, no state machine changes
    save_web_message(sid, 'bot', bt('photo_processing', img_lang))

    # Background: shadow parse (AI runs silently, result stored for operator pre-fill)
    background_tasks.add_task(
        _shadow_parse_image, sid, queue_id, str(filepath),
        file.content_type or 'image/jpeg', language
    )

    return {
        'user_message_id': user_msg_id,
        'media_url': media_url,
        'queue_id': queue_id,
        'processing': True,
    }


def _shadow_parse_image(store_id: int, queue_id: int, filepath: str,
                        mime_type: str, language: str = 'hinglish'):
    """Background: run AI parse silently and store result for operator pre-fill.
    Does NOT send any message to user. Does NOT change bot_state."""
    try:
        ctx   = build_store_context(store_id)
        etags = [t['tag'] for t in get_store_expense_tags(store_id, limit=15)]

        # Fetch per-store vocabulary for AI prompt enrichment
        store_vocab = {}
        try:
            ai_config = get_store_ai_config(store_id)
            store_vocab = json.loads(ai_config.get('store_vocabulary') or '{}')
        except Exception:
            pass

        parsed = parse_image_message(
            image_url=None,
            local_path=filepath,
            local_mime=mime_type,
            store_context=ctx,
            language=language,
            existing_tags=etags,
            store_vocabulary=store_vocab,
        )
        # Save full AI output as JSON to shadow parses table
        ai_output_json = json.dumps(parsed, ensure_ascii=False, default=str)
        save_shadow_parse(
            store_id=store_id,
            queue_id=queue_id,
            image_path=filepath,
            ai_output=ai_output_json,
            model_used='claude-sonnet-4-20250514',
            prompt_version='v1',
        )
        txns = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
        log.info(f"Shadow parse for queue {queue_id} (store {store_id}): {len(txns)} transactions")

    except Exception as e:
        log.error(f"Shadow parse failed for queue {queue_id}: {e}")
        # Save error as ai_output so operator knows AI failed
        save_shadow_parse(
            store_id=store_id,
            queue_id=queue_id,
            image_path=filepath,
            ai_output=json.dumps({'error': str(e)[:200]}),
            model_used='claude-sonnet-4-20250514',
            prompt_version='v1',
        )


@app.get('/api/messages')
async def api_get_messages(phone: str, after_id: int = 0):
    """Poll for new messages. Returns messages newer than after_id."""
    store = get_or_create_store(phone)
    sid   = store['id']
    msgs  = get_web_messages(sid, after_id=after_id)

    # Check if image is currently being processed
    bot_state  = get_bot_state(sid)
    processing = bool(bot_state.get('processing_image', False))

    return {
        'messages':   msgs,
        'processing': processing,
        'store_name': store.get('name', ''),
    }


@app.get('/api/profile')
async def api_get_profile(phone: str):
    """Return store profile info for the Profile page."""
    store = get_or_create_store(phone)
    return {
        'name':     store.get('name') or '',
        'language': store.get('language') or 'hinglish',
        'segment':  store.get('segment') or 'general',
        'joined':   store.get('created_at') or None,
        'phone':    phone,
    }


class ProfileUpdate(BaseModel):
    phone:    str
    name:     Optional[str] = None
    language: Optional[str] = None
    segment:  Optional[str] = None


@app.put('/api/profile')
async def api_update_profile(req: ProfileUpdate):
    """Update store name and/or language."""
    store = get_or_create_store(req.phone)
    updates = {}
    if req.name is not None:
        updates['name'] = req.name.strip()
    if req.language is not None:
        updates['language'] = req.language
    if req.segment is not None:
        updates['segment'] = req.segment
    if updates:
        update_store(store['id'], **updates)
    return {'ok': True}


@app.delete('/api/messages')
async def api_clear_chat(phone: str):
    """Clear all messages AND transactions for a store, reset bot state."""
    store = get_or_create_store(phone)
    clear_store_data(store['id'])
    return {'ok': True}


import re as _re

def _infer_expense_tag(desc: str, existing_tags: list) -> str:
    """Lightweight keyword-based tag inference for expenses missing a tag."""
    d = (desc or '').lower()
    # Check if description matches any existing tag keyword
    for tag in existing_tags:
        if tag.replace('_', ' ') in d or tag in d:
            return tag
    # Keyword rules
    _RULES = [
        (r'\b(salary|staff|wages?|labour)\b', 'staff_expense'),
        (r'\b(rent|kiraya)\b', 'rent'),
        (r'\b(electric|bijli|power)\b', 'electricity'),
        (r'\b(petrol|diesel|fuel|gas)\b', 'petrol'),
        (r'\b(food|khana|lunch|dinner|breakfast|refreshment|chai|tea|coffee)\b', 'refreshment'),
        (r'\b(transport|auto|rikshaw|taxi|bus|freight|courier)\b', 'transport'),
        (r'\b(repair|maintenance|service)\b', 'repair'),
        (r'\b(phone|mobile|telephone|recharge)\b', 'telephone'),
        (r'\b(water|pani)\b', 'water'),
        (r'\b(insurance|bima)\b', 'insurance'),
        (r'\b(packaging|packing)\b', 'packaging'),
        (r'\b(cleaning|safai|sweep)\b', 'cleaning'),
        (r'\b(discount|cash discount)\b', 'cash_discount'),
        (r'\b(purchase|khareed|buy|bought|saman)\b', 'purchase'),
        (r'\b(office|stationary|supply|supplies)\b', 'office_supplies'),
        (r'\b(dry.?clean|laundry|dhobi)\b', 'dry_cleaning'),
        (r'\b(toffee|sweet|candy|biscuit|snack)\b', 'shop_supplies'),
    ]
    for pattern, tag in _RULES:
        if _re.search(pattern, d):
            return tag
    return 'store_expense'


@app.post('/api/confirm')
async def api_confirm(req: ConfirmRequest):
    """Save (possibly edited) transactions from the confirm card UI."""
    store = get_or_create_store(req.phone)
    sid   = store['id']

    # Ensure every expense has a tag — use AI parser for untagged expenses
    untagged = [(i, t) for i, t in enumerate(req.transactions)
                if t.get('type') == 'expense' and not t.get('tag')]
    if untagged:
        existing_tags = [et['tag'] for et in get_store_expense_tags(sid, limit=15)]
        descs = [t.get('description', '') for _, t in untagged]
        try:
            from execution.moneybook_parser import assign_expense_tags
            tags = assign_expense_tags(descs, existing_tags)
            for (idx, t), tag in zip(untagged, tags):
                req.transactions[idx]['tag'] = tag
        except Exception:
            # Fallback to keyword inference if AI call fails
            for idx, t in untagged:
                req.transactions[idx]['tag'] = _infer_expense_tag(t.get('description', ''), existing_tags)

    saved = []
    for t in req.transactions:
        txn_id = add_transaction(sid, t, source='web_confirmed')
        saved.append({**{k: v for k, v in t.items()}, 'id': txn_id})

    # Flip the bot message metadata: confirmed, no longer pending
    if req.bot_message_id:
        update_message_metadata(req.bot_message_id, {'confirmed_transactions': saved})

    # ── 3-tier learning: diff original AI parse vs what user confirmed ──
    # This is the same learning that WhatsApp triggers via "galat N",
    # now applied to every web ConfirmCard edit.
    corrections_saved = 0
    if req.original_transactions:
        store_segment = get_store_segment(sid)
        LEARNING_FIELDS = {'type', 'amount', 'description', 'tag', 'person_name', 'payment_mode'}

        for i, corrected in enumerate(req.transactions):
            if i >= len(req.original_transactions):
                break
            orig = req.original_transactions[i]

            # Only learn if something meaningful actually changed
            changed = any(
                str(orig.get(f)) != str(corrected.get(f))
                for f in LEARNING_FIELDS
            )
            if not changed:
                continue

            try:
                scope = classify_correction_scope(orig, corrected, store_segment)
                save_correction(
                    store_id       = sid,
                    raw_text       = '',   # no raw text in web flow; JSON diff is enough
                    original_json  = orig,
                    corrected_json = corrected,
                    entry_index    = i + 1,
                    scope          = scope,
                    segment        = store_segment if scope == 'segment' else None,
                )
                if scope in ('segment', 'global'):
                    promote_correction(sid, corrected,
                                       target_scope=scope,
                                       target_segment=store_segment if scope == 'segment' else None)
                corrections_saved += 1
                log.info(f"Web correction learned: store={sid} entry={i+1} scope={scope} "
                         f"type:{orig.get('type')}→{corrected.get('type')} "
                         f"tag:{orig.get('tag')}→{corrected.get('tag')}")
            except Exception as e:
                log.warning(f"Failed to save correction for entry {i+1}: {e}")

    # ── Person classification for any new names ──
    # Build candidate list: parser said needs_tracking=True and name not already known
    candidates = list(dict.fromkeys(
        t.get('person_name') for t in req.transactions
        if t.get('person_name') and t.get('needs_tracking', False)
    ))
    unknown_candidates = get_unknown_persons(sid, candidates) if candidates else []

    # Use Haiku to confirm each unknown name is actually a real trackable person
    # (filters out words like "Manual", "Counter" etc. that parser misextracted)
    trackable = []
    for name in unknown_candidates:
        txn = next((t for t in req.transactions if t.get('person_name') == name), {})
        if is_trackable_person(
            name=name,
            description=txn.get('description', ''),
            txn_type=txn.get('type', ''),
            amount=txn.get('amount', 0),
        ):
            trackable.append(name)
    unknown = trackable

    if unknown:
        next_name = unknown[0]
        names_str = '\n'.join([f"{k}. {v}" for k, v in PERSON_LABELS.items()])
        classify_text = f"👤 *{next_name}* kaun hai?\n\n{names_str}"
        set_bot_state(sid, {
            'state':         'classifying',
            'persons_queue': unknown,
            'person_index':  0,
        })
        save_web_message(sid, 'bot', classify_text, quick_replies=['1', '2', '3', '4'])
    else:
        clear_bot_state(sid)

    return {
        'saved':                  len(saved),
        'confirmed_transactions': saved,
        'corrections_learned':    corrections_saved,
        'classification_pending': len(unknown) > 0,
    }


@app.get('/api/dues/person')
async def api_dues_person_history(phone: str, name: str):
    """Full udhaar ledger for a single person — every given and received event."""
    store = get_or_create_store(phone)
    return get_person_udhaar_history(store['id'], name)


@app.post('/api/dismiss')
async def api_dismiss(phone: str, bot_message_id: int):
    """Mark a ConfirmCard message as dismissed (user clicked ❌)."""
    store = get_or_create_store(phone)
    update_message_metadata(bot_message_id, {'dismissed': True})
    clear_bot_state(store['id'])
    return {'ok': True}


class DismissBulkRequest(BaseModel):
    phone: str
    message_ids: list  # list of int message IDs to mark dismissed
    cancel_text: Optional[str] = None  # if provided, save as a new bot message


@app.post('/api/dismiss-bulk')
async def api_dismiss_bulk(req: DismissBulkRequest):
    """Bulk-dismiss ack messages and optionally persist a cancel message."""
    store = get_or_create_store(req.phone)
    sid = store['id']
    for mid in req.message_ids:
        try:
            update_message_metadata(mid, {'dismissed': True})
        except Exception:
            pass  # best-effort; ignore missing IDs
    cancel_msg_id = None
    if req.cancel_text:
        cancel_msg_id = save_web_message(sid, 'bot', req.cancel_text)
    return {'ok': True, 'cancel_msg_id': cancel_msg_id}


@app.delete('/api/transaction')
async def api_delete_transaction(phone: str, txn_id: int):
    """Hard-delete a single saved transaction."""
    store = get_or_create_store(phone)
    deleted = delete_transaction(store['id'], txn_id)
    if not deleted:
        raise HTTPException(status_code=404, detail='Transaction not found')
    return {'deleted': True, 'txn_id': txn_id}


# ─────────────────────────────────────────────────────────────────
# Analytics API
# ─────────────────────────────────────────────────────────────────

@app.get('/api/analytics')
async def api_analytics(
    phone: str,
    period: str = 'day',
    start: Optional[str] = None,   # YYYY-MM-DD  — custom range override
    end:   Optional[str] = None,   # YYYY-MM-DD  — custom range override
):
    """Returns analytics data for the given period or a custom date range."""
    store = get_or_create_store(phone)
    sid = store['id']
    today = date.today()

    if start and end:
        # Custom date range supplied directly — validate and use as-is
        try:
            date.fromisoformat(start)
            date.fromisoformat(end)
        except ValueError:
            raise HTTPException(status_code=400, detail='Invalid date format. Use YYYY-MM-DD.')
        period = 'custom'
    elif period == 'day':
        start = today.isoformat()
        end   = today.isoformat()
    elif period == 'week':
        start = (today - timedelta(days=6)).isoformat()
        end   = today.isoformat()
    elif period == 'month':
        start = today.replace(day=1).isoformat()
        end   = today.isoformat()
    else:  # year
        start = today.replace(month=1, day=1).isoformat()
        end   = today.isoformat()

    period_data   = get_period_summary(sid, start, end)
    summary       = period_data.get('summary', {})

    total_sales         = summary.get('sale', 0) or 0
    total_op_expenses   = period_data.get('operating_expense', 0) or 0
    total_staff_expense = period_data.get('staff_expense', 0) or 0
    total_expenses      = total_op_expenses + total_staff_expense
    net_pnl             = total_sales - total_expenses
    udhaar_out          = sum(u['balance'] for u in get_udhaar_outstanding(sid))
    udhaar_given_period    = period_data.get('udhaar_given_period', 0)
    udhaar_received_period = period_data.get('udhaar_received_period', 0)

    # Additional breakdowns
    daily_trend      = get_daily_trend(sid, start, end)
    staff_payments   = get_staff_payments(sid, start, end)
    payment_split    = get_payment_mode_split(sid, start, end)
    top_receivers    = get_top_receivers(sid, start, end)
    others_summary   = get_others_summary(sid, start, end)

    # Quick dues summary for click-through
    udhaar_list = get_udhaar_outstanding(sid)   # already fetched above for udhaar_out
    dues_summary = [
        {'name': u['person_name'], 'balance': u['balance']}
        for u in sorted(udhaar_list, key=lambda x: -x['balance'])[:10]
    ]

    return {
        'period': period,
        'start':  start,
        'end':    end,
        'kpis': {
            'total_sales':             total_sales,
            'total_expenses':          total_expenses,
            'operating_expenses':      total_op_expenses,
            'staff_expenses':          total_staff_expense,
            'net_pnl':                 net_pnl,
            'udhaar_outstanding':      udhaar_out,
            'udhaar_given_period':     udhaar_given_period,
            'udhaar_received_period':  udhaar_received_period,
        },
        'expense_tags':   period_data.get('expense_tags', {}),
        'daily_trend':    daily_trend,
        'staff_payments': staff_payments,
        'payment_split':  payment_split,
        'top_receivers':  top_receivers,
        'dues_summary':   dues_summary,
        'others_summary': others_summary,
    }


class LedgerClassifyRequest(BaseModel):
    phone:    str
    date:     str                         # YYYY-MM-DD
    rows:     list                        # [{ particulars, amount, column: 'in'|'out' }]
    language: Optional[str] = None        # ignored (store language used), but accepted

@app.post('/api/ledger-classify')
async def api_ledger_classify(req: LedgerClassifyRequest):
    """
    Classify ledger rows entered manually by the user.
    Each row has: particulars (description), amount, column ('in' or 'out').
    System decides type, tag, person_name etc. using the text parser.
    Returns pending_transactions in the same format as the image/text parse endpoints.
    """
    store    = get_or_create_store(req.phone)
    sid      = store['id']
    ctx      = build_store_context(sid)
    etags    = [t['tag'] for t in get_store_expense_tags(sid, limit=15)]
    language = store.get('language', 'hinglish')
    today    = req.date or date.today().isoformat()

    # Build a structured natural-language prompt from the ledger rows
    # Include column context so parser knows IN vs OUT intent
    in_rows  = [r for r in req.rows if r.get('column') == 'in'  and r.get('particulars') and r.get('amount')]
    out_rows = [r for r in req.rows if r.get('column') == 'out' and r.get('particulars') and r.get('amount')]

    lines = [f"Date: {today}", "Ledger entries for today:"]
    for r in in_rows:
        lines.append(f"IN  | {r['particulars']} | ₹{r['amount']}")
    for r in out_rows:
        lines.append(f"OUT | {r['particulars']} | ₹{r['amount']}")

    message = '\n'.join(lines)

    try:
        parsed = parse_text_message(message, store_context=ctx, language=language, existing_tags=etags)
        txns   = parsed.get('transactions', [])

        # Force date on all transactions and auto-classify section-tagged rows
        # Build ordered section list from request rows (same order as lines fed to parser)
        ordered_sections = []
        for r in in_rows:
            ordered_sections.append(r)
        for r in out_rows:
            ordered_sections.append(r)

        for i, t in enumerate(txns):
            t['date'] = today
            # Match by index — rows were fed to parser in same order
            src = ordered_sections[i] if i < len(ordered_sections) else {}
            section = src.get('section', 'general')
            # Preserve manually-entered tag from ledger row if AI didn't assign one
            manual_tag = src.get('tag', '').strip()
            if manual_tag and not t.get('tag'):
                t['tag'] = manual_tag
            person  = t.get('person_name') or src.get('person_name', '')
            col     = src.get('column', 'in')
            if section == 'staff':
                # Staff OUT → expense with staff_expense tag
                if col == 'out':
                    t['type'] = 'expense'
                    t['tag']  = 'staff_expense'
                if person:
                    save_person(store['id'], person, 'staff')
                t['needs_tracking'] = False
                t['person_category'] = 'staff'
            elif section == 'dues':
                # Left/IN column = "Udhaar receivable" → dues_given (creates +balance, shows in Dues tab)
                # Right/OUT column = "Payment received" → dues_received (reduces balance)
                t['type'] = 'dues_received' if col == 'out' else 'dues_given'
                if person:
                    save_person(store['id'], person, 'customer')
                    t['person_name'] = person  # must persist so add_transaction updates udhaar
                t['needs_tracking'] = False
                t['person_category'] = 'customer'
            elif section == 'others':
                # Others — keep AI-parsed type, do NOT force expense
                t['type'] = 'other'
                t['column'] = col  # preserve IN/OUT side for display
                if person:
                    save_person(store['id'], person, 'supplier')
                t['needs_tracking'] = False
                t['person_category'] = 'supplier'
            elif section == 'general' and col == 'out':
                # General OUT column: if AI mistakenly set dues_received/udhaar_received,
                # flip to dues_given — OUT means we gave credit, not that we received payment.
                if t.get('type') in ('dues_received', 'udhaar_received'):
                    import re as _re
                    t['type'] = 'dues_given' if t['type'] == 'dues_received' else 'udhaar_given'
                    # Extract clean person name from description
                    raw_desc = t.get('description', '')
                    if not t.get('person_name') or len((t.get('person_name') or '').split()) > 4:
                        extracted = _extract_name_from_desc(raw_desc) or t.get('person_name', '')
                        if extracted:
                            t['person_name'] = extracted
                            save_person(store['id'], extracted, 'customer')
                    # Clean description: "received from X" → "given to X"
                    if raw_desc:
                        clean = _re.sub(r'\breceived\b', 'given', raw_desc, flags=_re.IGNORECASE)
                        clean = _re.sub(r'\bfrom\b', 'to', clean, flags=_re.IGNORECASE)
                        t['description'] = clean
                    t['needs_tracking'] = False
                    t['person_category'] = 'customer'
            elif section != 'general':
                # Any other tagged section — skip classification
                t['needs_tracking'] = False

        response_msg = parsed.get('response_message', f'{len(txns)} entries from ledger')
        msg_id = save_web_message(
            store['id'], 'bot', response_msg,
            metadata={
                'pending_transactions': txns,
                'source': 'ledger',
                'page_date': today,
            }
        )
        return {
            'message_id':           msg_id,
            'pending_transactions':  txns,
            'response_message':     response_msg,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ClassifyPersonsRequest(BaseModel):
    phone:           str
    classifications: list   # [{ name: str, category: str }]

@app.post('/api/classify-persons')
async def api_classify_persons(req: ClassifyPersonsRequest):
    """Batch-classify persons (staff/customer/supplier/home)."""
    store = get_or_create_store(req.phone)
    sid   = store['id']
    for item in (req.classifications or []):
        name = (item.get('name') or '').strip()
        cat  = item.get('category', 'customer')
        if name:
            save_person(sid, name, cat)
    return {'saved': len(req.classifications or [])}


@app.post('/api/quick-parse')
async def api_quick_parse(req: QuickParseRequest):
    """Parse a minimal hint (description + amount + person) into a full transaction object."""
    from moneybook_parser import parse_text_message
    # Build natural language from hint
    parts = [req.description]
    if req.amount:
        parts.append(str(req.amount))
    if req.person_name:
        parts.append(req.person_name)
    msg = ' '.join(parts)

    try:
        parsed = parse_text_message(msg)
        txns = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
        if txns:
            t = txns[0]
            t['amount'] = req.amount  # honour user's exact amount
            if req.person_name:
                t['person_name'] = req.person_name
            return {'transaction': t}
    except Exception:
        pass

    # Fallback: best-effort
    return {'transaction': {
        'type': 'expense',
        'amount': req.amount,
        'description': req.description,
        'tag': 'other',
        'person_name': req.person_name or None,
        'needs_tracking': bool(req.person_name),
        'payment_mode': 'cash',
        'date': date.today().isoformat(),
    }}


# ─────────────────────────────────────────────────────────────────
# Dues & Staff API
# ─────────────────────────────────────────────────────────────────

@app.get('/api/dues')
async def api_dues(phone: str, start: str = None, end: str = None):
    """Returns pending dues + dues received, with optional date range for received."""
    store    = get_or_create_store(phone)
    sid      = store['id']
    dues     = get_dues_with_detail(sid)
    received = get_dues_received(sid, start=start, end=end)
    return {'dues': dues, 'dues_received': received}


@app.post('/api/dues/contact')
async def api_update_contact(req: UpdateContactRequest):
    """Save contact number for a person in udhaar table."""
    store = get_or_create_store(req.phone)
    sid   = store['id']
    update_udhaar_contact(sid, req.person_name, req.contact_phone)
    return {'ok': True}


@app.get('/api/staff')
async def api_staff(phone: str, start: Optional[str] = None, end: Optional[str] = None):
    """Returns staff payment summary, optionally filtered by date range."""
    store = get_or_create_store(phone)
    sid   = store['id']
    staff = get_staff_detail(sid, start=start, end=end)
    return {'staff': staff}


@app.get('/api/suppliers')
async def api_suppliers(phone: str, start: Optional[str] = None, end: Optional[str] = None):
    """Returns supplier/party transaction summary."""
    store = get_or_create_store(phone)
    sid = store['id']
    suppliers = get_supplier_detail(sid, start=start, end=end)
    return {'suppliers': suppliers}


@app.get('/api/others')
async def api_others(phone: str, start: Optional[str] = None, end: Optional[str] = None):
    """Returns other transactions (not dues, staff, or supplier)."""
    store = get_or_create_store(phone)
    sid = store['id']
    others = get_others_detail(sid, start=start, end=end)
    return {'others': others}


@app.get('/api/others-grouped')
async def api_others_grouped(phone: str, start: Optional[str] = None, end: Optional[str] = None):
    """Returns other transactions grouped by description."""
    store = get_or_create_store(phone)
    sid = store['id']
    groups = get_others_grouped(sid, start=start, end=end)
    return {'groups': groups}


@app.get('/api/expense-categories')
async def api_expense_categories(phone: str):
    """Returns the store's existing expense tag categories (max 15)."""
    from execution.moneybook_parser import TAG_META
    store = get_or_create_store(phone)
    sid   = store['id']
    tags  = get_store_expense_tags(sid, limit=15)
    result = []
    for t in tags:
        tag = t['tag']
        meta = TAG_META.get(tag, (tag.replace('_', ' ').title(), '📝'))
        result.append({
            'tag':   tag,
            'label': meta[0],
            'emoji': meta[1],
            'count': t['count'],
        })
    return {'categories': result}


# ── Text-to-Speech ────────────────────────────────────────────

# Google Cloud TTS — Neural2/WaveNet voices trained on native regional speakers
# (language_code, voice_name) — Neural2 where available, WaveNet fallback
_GOOGLE_TTS_VOICES = {
    'hinglish': ('hi-IN', 'hi-IN-Neural2-D'),   # male Hindi — Hinglish text is Roman Hindi
    'hindi':    ('hi-IN', 'hi-IN-Neural2-A'),   # female Hindi
    'gujarati': ('gu-IN', 'gu-IN-Wavenet-B'),   # male Gujarati
    'marathi':  ('mr-IN', 'mr-IN-Wavenet-C'),   # male Marathi
    'bengali':  ('bn-IN', 'bn-IN-Wavenet-B'),   # male Bengali
    'tamil':    ('ta-IN', 'ta-IN-Wavenet-B'),   # male Tamil
    'telugu':   ('te-IN', 'te-IN-Wavenet-B'),   # male Telugu
    'kannada':  ('kn-IN', 'kn-IN-Wavenet-B'),   # male Kannada
    'punjabi':  ('pa-IN', 'pa-IN-Wavenet-B'),   # male Punjabi
    'english':  ('en-IN', 'en-IN-Neural2-B'),   # male Indian English
}

# Language-specific phrases (intro / section labels / date emphasis)
_TTS_PHRASES = {
    'hinglish': dict(
        intro='{total} entries mili notebook mein. Tarikh {date} ki hai.',
        jama='Jama', naam='Naam', rupees='rupaye',
        date_warn='Zaroori baat:',
        date_set='Tarikh abhi {date} set hai.',
        date_tip='Save karne se pehle tarikh zaroor check karein. Galat ho toh upar wala date banner tap karein aur sahi karein.',
    ),
    'hindi': dict(
        intro='{total} entries mili notebook mein. Tarikh {date} ki hai.',
        jama='Jama', naam='Naam', rupees='rupaye',
        date_warn='Bahut zaroori:',
        date_set='Tarikh abhi {date} set hai.',
        date_tip='Save karne se pehle tarikh zaroor check karein. Galat ho toh upar wala date banner par tap karein.',
    ),
    'english': dict(
        intro='{total} entries found in the notebook. Date is {date}.',
        jama='JAMA', naam='NAAM', rupees='rupees',
        date_warn='Important:',
        date_set='The date is currently set to {date}.',
        date_tip='Please verify the date before saving. If incorrect, tap the date banner at the top to change it.',
    ),
    'gujarati': dict(
        intro='Notebook mein {total} entries meli che. Tarikh {date} ni che.',
        jama='Jama', naam='Naam', rupees='rupiya',
        date_warn='Jaruri:',
        date_set='Tarikh haal {date} set che.',
        date_tip='Save karta pehla tarikh jaroor check karo. Galat hoy to upar date banner tap karo.',
    ),
    'marathi': dict(
        intro='Notebook madhye {total} entries saapadlya. Tarikh {date} ahe.',
        jama='Jama', naam='Naam', rupees='rupaye',
        date_warn='Mahtvache:',
        date_set='Tarikh aata {date} set ahe.',
        date_tip='Save karaypurvi tarikh nakki tapasaa. Chukiche aslyaas varchil date banner var tap karaa.',
    ),
    'bengali': dict(
        intro='Notebook-e {total}ta entry paoa gache. Tarikh {date}.',
        jama='Jama', naam='Naam', rupees='taka',
        date_warn='Guruttopurno:',
        date_set='Tarikh ekhon {date} set ache.',
        date_tip='Save korar age tarikh obossoi check korun. Vul hole uporer date banner-e tap korun.',
    ),
    'tamil': dict(
        intro='Notebook-il {total} entries kaanappattathu. Thethi {date}.',
        jama='Jama', naam='Naam', rupees='rubai',
        date_warn='Mukkiyam:',
        date_set='Thethi ippo {date} set aagirudhu.',
        date_tip='Save seivadharku munbu thethiyai sari paarungal. Thappu irundhal mele ulhla date banner-ai tap seyyungal.',
    ),
    'telugu': dict(
        intro='Notebook-lo {total} entries kanugonnaamu. Tareedhu {date}.',
        jama='Jama', naam='Naam', rupees='rupayalu',
        date_warn='Mukhyamainatee:',
        date_set='Tareedhu ippudu {date} set chesindi.',
        date_tip='Save cheyyamundhu tareedhu tappakunda check cheyyandi. Tappu aite paina date banner ni tap cheyyandi.',
    ),
    'kannada': dict(
        intro='Notebook-nalli {total} entries sikvide. Dhinanka {date}.',
        jama='Jama', naam='Naam', rupees='rupai',
        date_warn='Mukhya:',
        date_set='Dhinanka eeaga {date} set agide.',
        date_tip='Save maduvudakku munche dhinankavanna tapasaatakoli. Tappu aadre mele iruva date banner tap madiri.',
    ),
    'punjabi': dict(
        intro='Notebook vich {total} entries milyaan. Tarikh {date} hai.',
        jama='Jama', naam='Naam', rupees='rupaye',
        date_warn='Zaroori:',
        date_set='Tarikh hune {date} set hai.',
        date_tip='Save karan ton pehlan tarikh zaroor check karo. Galat hove tan upar wala date banner tap karo.',
    ),
}

# Stronger date phrases used when date was NOT found in the photo
_DATE_MISSING_PHRASES = {
    'hinglish': dict(
        intro_no_date='{total} entries mili notebook mein. Lekin notebook mein tarikh nahi mili — isliye aaj ki tarikh {date} set ki gayi hai.',
        date_warn_strong='RUKHIYE! Save karne se pehle — tarikh notebook mein nahi thi.',
        date_set_default='Abhi {date} set hai, jo ki aaj ki tarikh hai. Yeh GALAT ho sakti hai.',
        date_tip_strong='Upar wala date banner zaroor tap karein aur sahi tarikh set karein. Galat tarikh se hisaab bigad jaayega.',
    ),
    'hindi': dict(
        intro_no_date='{total} entries mili notebook mein. Parantu notebook mein tarikh nahi mili — isliye aaj ki tarikh {date} set ki gayi hai.',
        date_warn_strong='RUKIYE! Save karne se pehle — tarikh notebook mein nahi thi.',
        date_set_default='Abhi {date} set hai jo aaj ki tarikh hai. Yeh GALAT ho sakti hai.',
        date_tip_strong='Upar wala date banner zaroor tap karein aur sahi tarikh darj karein.',
    ),
    'english': dict(
        intro_no_date='{total} entries found. However, no date was found in the notebook — today\'s date {date} has been set automatically.',
        date_warn_strong='STOP before saving — the date was missing from the notebook.',
        date_set_default='Currently set to {date}, which is today\'s date. This may be INCORRECT.',
        date_tip_strong='Please tap the date banner at the top and set the correct date. Wrong date will cause incorrect records.',
    ),
    'gujarati': dict(
        intro_no_date='{total} entries meli notebook mein. Pan notebook mein tarikh nahi meli — aaj ni tarikh {date} set kareli che.',
        date_warn_strong='ROKO! Save karta pehla — tarikh notebook mein nathi.',
        date_set_default='Haal {date} set che, je aaj ni tarikh che. Aa GALAT ho sake che.',
        date_tip_strong='Upar wala date banner jaroor tap karo ane sahi tarikh mukho.',
    ),
    'marathi': dict(
        intro_no_date='{total} entries saapadlya. Paran notebook madhye tarikh nahi — aajchi tarikh {date} set keli ahe.',
        date_warn_strong='THAMBA! Save karaypurvi — tarikh notebook madhye navhati.',
        date_set_default='Aata {date} set ahe, jo aajchi tarikh ahe. Hi CHUKICHI astu shakate.',
        date_tip_strong='Varchil date banner tapaa aani yogya tarikh set karaa.',
    ),
    'bengali': dict(
        intro_no_date='{total}ta entry paoa gache. Kintu notebook-e kono tarikh paoa jaynee — aajker tarikh {date} set kora hoyeche.',
        date_warn_strong='THAMON! Save korar age — tarikh notebook-e chilo na.',
        date_set_default='Ekhon {date} set ache, jeta aajker tarikh. Eta VOOL hote pare.',
        date_tip_strong='Uporer date banner-e tap korun ebong sothik tarikh set korun.',
    ),
    'tamil': dict(
        intro_no_date='{total} entries kaanappattathu. Anal notebook-il thethi illai — indraya thethi {date} set aagiyuludhu.',
        date_warn_strong='NIRUTHUNGA! Save seivadharku munbu — thethi notebook-il illai.',
        date_set_default='Ippo {date} set aagirudhu, idu indraya thethi. Idu THAPPU aaga irukkalam.',
        date_tip_strong='Mele ulhla date banner-ai tap seytu sari thethi set seyyungal.',
    ),
    'telugu': dict(
        intro_no_date='{total} entries kanugonnaamu. Kaani notebook-lo tareedhu ledu — nee tareedhu {date} set chesaamu.',
        date_warn_strong='AAGANDI! Save cheyyamundhu — tareedhu notebook-lo ledu.',
        date_set_default='Ippudu {date} set chesindi, idi nee tareedhu. Idi TAPPU kaavachu.',
        date_tip_strong='Paina date banner ni tap chesi sari tareedhu set cheyyandi.',
    ),
    'kannada': dict(
        intro_no_date='{total} entries sikvide. Aadare notebook-nalli dhinanka illa — inda dhinanka {date} set madalaagide.',
        date_warn_strong='NILLIST! Save maduvudakku munche — dhinanka notebook-nalli irlilla.',
        date_set_default='Eeaga {date} set agide, idu indina dhinanka. Idu TAPPU aagabahudu.',
        date_tip_strong='Mele iruva date banner tap madi sari dhinanka set madiri.',
    ),
    'punjabi': dict(
        intro_no_date='{total} entries milyaan notebook vich. Par notebook vich tarikh nahi mili — aaj di tarikh {date} set kar ditti gayi hai.',
        date_warn_strong='RUKO! Save karan ton pehlan — tarikh notebook vich nahi si.',
        date_set_default='Hune {date} set hai, jo aaj di tarikh hai. Eh GALAT ho sakdi hai.',
        date_tip_strong='Upar wala date banner zaroor tap karo te sahi tarikh paao.',
    ),
}

import html as _html

def _build_ledger_text(in_entries: list, out_entries: list, date_str: str,
                        language: str, date_from_photo: bool = True) -> str:
    """Build SSML text for Google TTS with <break> pauses and natural phrasing.
    date_from_photo=False means the date was not found in the image and defaulted to today —
    triggers a much stronger date warning.
    """
    ph    = _TTS_PHRASES.get(language, _TTS_PHRASES['hinglish'])
    total = len(in_entries) + len(out_entries)

    def amt(a):
        try: return str(int(float(a)))
        except: return str(a)

    parts = []

    # Intro
    if date_from_photo:
        parts.append(ph['intro'].format(total=total, date=date_str))
    else:
        missing = _DATE_MISSING_PHRASES.get(language, _DATE_MISSING_PHRASES['hinglish'])
        parts.append(missing['intro_no_date'].format(total=total, date=date_str))
    parts.append('<break time="500ms"/>')

    # Date warning — at the START before entries so user checks immediately
    parts.append('<mark name="date"/>')
    if date_from_photo:
        parts.append(ph['date_warn'])
        parts.append('<break time="400ms"/>')
        parts.append(ph['date_set'].format(date=date_str))
        parts.append('<break time="300ms"/>')
        parts.append(ph['date_tip'])
    else:
        missing = _DATE_MISSING_PHRASES.get(language, _DATE_MISSING_PHRASES['hinglish'])
        parts.append(missing['date_warn_strong'])
        parts.append('<break time="500ms"/>')
        parts.append(missing['date_set_default'].format(date=date_str))
        parts.append('<break time="400ms"/>')
        parts.append(missing['date_tip_strong'])
    parts.append('<break time="700ms"/>')

    # JAMA entries
    if in_entries:
        parts.append(f'{ph["jama"]} mein {len(in_entries)} entries:')
        parts.append('<break time="300ms"/>')
        for i, e in enumerate(in_entries):
            parts.append(f'<mark name="in_{i}"/>')
            parts.append(f'{i+1}. {e.get("desc","")}, <say-as interpret-as="cardinal">{amt(e.get("amount",0))}</say-as> {ph["rupees"]}.')
            parts.append('<break time="200ms"/>')

    parts.append('<break time="400ms"/>')

    # NAAM entries
    if out_entries:
        parts.append(f'{ph["naam"]} mein {len(out_entries)} entries:')
        parts.append('<break time="300ms"/>')
        for i, e in enumerate(out_entries):
            parts.append(f'<mark name="out_{i}"/>')
            parts.append(f'{i+1}. {e.get("desc","")}, <say-as interpret-as="cardinal">{amt(e.get("amount",0))}</say-as> {ph["rupees"]}.')
            parts.append('<break time="200ms"/>')

    return ' '.join(parts)


class TTSRequest(BaseModel):
    in_entries:      list
    out_entries:     list
    date_str:        str
    language:        Optional[str] = 'hinglish'
    date_from_photo: Optional[bool] = True  # False = date defaulted to today (not found in image)


@app.post('/api/tts')
async def api_tts(req: TTSRequest):
    """Generate TTS audio using Google Cloud Text-to-Speech with regional voices."""
    import httpx, base64

    key = os.getenv('GOOGLE_API_KEY', '')
    if not key:
        raise HTTPException(status_code=503, detail='GOOGLE_API_KEY not configured')

    language = (req.language or 'hinglish').lower()
    text     = _build_ledger_text(req.in_entries, req.out_entries, req.date_str, language,
                                  date_from_photo=req.date_from_photo)

    # Wrap in SSML speak tags — _build_ledger_text already uses <break> tags
    ssml = f'<speak>{text}</speak>'
    lang_code, voice_name = _GOOGLE_TTS_VOICES.get(language, _GOOGLE_TTS_VOICES['hinglish'])

    url     = f'https://texttospeech.googleapis.com/v1beta1/text:synthesize?key={key}'
    payload = {
        'input':              {'ssml': ssml},
        'voice':              {'languageCode': lang_code, 'name': voice_name},
        'audioConfig':        {'audioEncoding': 'MP3', 'speakingRate': 1.10, 'pitch': 0.0},
        'enableTimePointing': ['SSML_MARK'],   # returns timepoints for <mark> tags
    }

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json=payload)
        if r.status_code == 200:
            data = r.json()
            return {
                'audio':      data.get('audioContent', ''),
                'voice':      voice_name,
                'timepoints': data.get('timepoints', []),   # [{markName, timeSeconds}, ...]
            }
        raise HTTPException(status_code=502, detail=f'Google TTS failed ({r.status_code}): {r.text[:300]}')


# ── Operator Dashboard Admin API ──────────────────────────────

def verify_admin_token(request: Request):
    """Verify admin auth. Accepts X-Admin-Key header OR Bearer token.
    Returns operator dict with id, username, name, role."""
    # Check X-Admin-Key first (backward compat)
    key = request.headers.get('X-Admin-Key', '')
    if key == os.getenv('ADMIN_KEY', 'moneybook-admin-2026'):
        return {'id': 0, 'username': 'system', 'name': 'System', 'role': 'admin'}

    # Check Bearer token
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        import base64, time as _time
        try:
            token = auth[7:]
            decoded = base64.b64decode(token).decode()
            parts = decoded.split(':')
            op_id, username, ts, secret = int(parts[0]), parts[1], int(parts[2]), parts[3]
            if secret != os.getenv('ADMIN_KEY', 'moneybook-admin-2026'):
                raise HTTPException(status_code=401, detail='Invalid token')
            # Token valid for 24 hours
            if _time.time() - ts > 86400:
                raise HTTPException(status_code=401, detail='Token expired')
            operator = get_operator_by_id(op_id)
            if not operator or not operator.get('active'):
                raise HTTPException(status_code=401, detail='Operator inactive')
            return operator
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=401, detail='Invalid token')

    raise HTTPException(status_code=401, detail='Authentication required')


@app.post('/api/admin/login')
async def admin_login(body: dict = Body(...)):
    """Operator login. Returns token and operator info."""
    username = body.get('username', '')
    password = body.get('password', '')
    operator = verify_operator(username, password)
    if not operator:
        raise HTTPException(status_code=401, detail='Invalid credentials')

    import base64, time as _time
    secret = os.getenv('ADMIN_KEY', 'moneybook-admin-2026')
    token_data = f"{operator['id']}:{operator['username']}:{int(_time.time())}:{secret}"
    token = base64.b64encode(token_data.encode()).decode()

    return {
        'token': token,
        'operator': {
            'id': operator['id'],
            'username': operator['username'],
            'name': operator['name'],
            'role': operator['role']
        }
    }


@app.get('/api/admin/me')
async def admin_me(request: Request):
    """Verify token and return operator info."""
    operator = verify_admin_token(request)
    return {'operator': {
        'id': operator['id'],
        'username': operator['username'],
        'name': operator['name'],
        'role': operator['role']
    }}


@app.get('/api/admin/descriptions')
async def admin_get_descriptions(request: Request, store_id: int, type: str):
    """Get previously used descriptions and tags for a transaction type in a store."""
    verify_admin_token(request)
    descs = get_descriptions_by_type(store_id, type, limit=30)
    tags = get_tags_by_type(store_id, type, limit=30)
    return {'descriptions': descs, 'tags': tags}


@app.get('/api/admin/queue')
async def admin_get_queue(request: Request, status: str = 'pending'):
    """List queue items with store name, thumbnail."""
    verify_admin_token(request)
    items = get_operator_queue(status=status)
    return {'items': items}


@app.post('/api/admin/queue/{queue_id}/pick')
async def admin_pick_queue(request: Request, queue_id: int, operator_id: str = 'default'):
    """Mark queue item as in_progress. Returns AI pre-fill if available."""
    operator = verify_admin_token(request)
    op_id = operator_id if operator_id != 'default' else str(operator.get('id', 'default'))
    update_queue_status(queue_id, 'in_progress', op_id)
    shadow = get_shadow_parse_for_queue(queue_id)
    ai_prefill = None
    if shadow and shadow.get('ai_output'):
        try:
            parsed = json.loads(shadow['ai_output'])
            txns = parsed.get('transactions', [])
            # Split into in/out for the operator form
            in_entries = []
            out_entries = []
            for t in txns:
                entry = {
                    'description': t.get('description', ''),
                    'amount': t.get('amount', 0),
                    'type': t.get('type', ''),
                    'person': t.get('person_name', ''),
                    'tag': t.get('tag', ''),
                    'confidence': t.get('confidence', None),
                }
                col = t.get('column', '')
                if col == 'out' or t.get('type') in ('expense', 'dues_given', 'bank_deposit'):
                    out_entries.append(entry)
                else:
                    in_entries.append(entry)
            ai_prefill = {
                'in': in_entries,
                'out': out_entries,
                'date': parsed.get('date'),
            }
        except Exception as e:
            log.error(f"Failed to parse AI output for queue {queue_id}: {e}")
    return {'status': 'picked', 'ai_prefill': ai_prefill}


@app.post('/api/admin/queue/{queue_id}/complete')
async def admin_complete_queue(request: Request, queue_id: int, body: dict = Body(...)):
    """Operator saves entries. Saves to transactions table, notifies user."""
    verify_admin_token(request)
    transactions = body.get('transactions', [])
    txn_date = body.get('date') or date.today().isoformat()
    notes = body.get('notes', '')

    # Get queue item to find store_id
    from moneybook_db import get_queue_item, delete_operator_transactions
    q = get_queue_item(queue_id)
    if not q:
        raise HTTPException(status_code=404, detail='Queue item not found')

    store_id = q['store_id']
    saved_ids = []

    # Delete existing operator-sourced transactions for the same date to avoid duplicates
    delete_operator_transactions(store_id, txn_date)

    # Save each transaction
    for txn in transactions:
        if not txn.get('date'):
            txn['date'] = txn_date
        tid = add_transaction(store_id, txn, raw_message=None, source='operator')
        saved_ids.append(tid)

    # Mark queue completed
    operator_output = json.dumps(transactions, ensure_ascii=False, default=str)
    complete_queue_item(queue_id, operator_output)

    # Score AI accuracy and trigger per-store learning
    accuracy_result = None
    try:
        shadow = get_shadow_parse_for_queue(queue_id)
        if shadow and shadow.get('ai_output'):
            ai_parsed = json.loads(shadow['ai_output'])
            ai_txns = ai_parsed.get('transactions', [])
            result = compute_accuracy(ai_txns, transactions)
            accuracy_result = result

            # Update store learning (vocabulary, few-shots, mode transition)
            update_store_learning(
                store_id, queue_id, ai_txns, transactions,
                result['overall_score']
            )
            log.info(
                f"Queue {queue_id} accuracy: {result['overall_score']:.1f}% "
                f"({len(result['matched_rows'])} matched, "
                f"{len(result['missed_by_ai'])} missed, "
                f"{len(result['hallucinated'])} hallucinated)"
            )
    except Exception as e:
        log.error(f"AI scoring failed for queue {queue_id}: {e}")

    # Notify user via web message
    count = len(transactions)
    save_web_message(store_id, 'bot',
                     f"✅ {count} entr{'ies' if count != 1 else 'y'} saved from your photo!")

    resp = {
        'status': 'completed',
        'saved_transaction_ids': saved_ids,
        'count': count,
    }
    if accuracy_result:
        resp['accuracy'] = {
            'overall_score': accuracy_result['overall_score'],
            'row_count_match': accuracy_result['row_count_match'],
            'field_breakdown': accuracy_result['field_breakdown'],
            'missed': len(accuracy_result['missed_by_ai']),
            'hallucinated': len(accuracy_result['hallucinated']),
        }
    return resp


@app.post('/api/admin/queue/{queue_id}/reject')
async def admin_reject_queue(request: Request, queue_id: int):
    """Bad photo — mark as skipped, notify user to resend."""
    verify_admin_token(request)

    from moneybook_db import get_queue_item
    q = get_queue_item(queue_id)
    if not q:
        raise HTTPException(status_code=404, detail='Queue item not found')

    update_queue_status(queue_id, 'skipped', notes='Rejected by operator — unclear photo')
    save_web_message(q['store_id'], 'bot',
                     "⚠️ Photo unclear. Please resend a clearer photo.")

    return {'status': 'skipped'}


@app.get('/api/admin/stats')
async def admin_stats(request: Request):
    """Dashboard stats: pending, in_progress, completed today, avg time, per-store accuracy."""
    verify_admin_token(request)

    from moneybook_db import get_admin_stats
    return get_admin_stats()


@app.get('/api/admin/queue/poll')
async def admin_poll_queue(request: Request, since: str = None):
    """Check for new queue items since a timestamp. Returns count."""
    verify_admin_token(request)

    from moneybook_db import poll_operator_queue
    return poll_operator_queue(since)


# ── Serve uploaded images ──────────────────────────────────────
_uploads_dir = Path(__file__).parent.parent / '.tmp' / 'uploads'
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount('/uploads', StaticFiles(directory=str(_uploads_dir)), name='uploads')

# ── Serve React webapp (MUST be last — catches all remaining routes) ──
_webapp_dist = Path(__file__).parent.parent / 'webapp' / 'dist'
if _webapp_dist.exists():
    from fastapi.responses import HTMLResponse, FileResponse
    from fastapi import Request

    # Serve index.html with no-cache so browser always fetches the latest build
    @app.get('/', response_class=HTMLResponse)
    @app.get('/index.html', response_class=HTMLResponse)
    async def serve_index(_req: Request):
        content = (_webapp_dist / 'index.html').read_text()
        return HTMLResponse(content=content, headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
        })

    # Hashed assets (JS/CSS) can be cached long-term
    app.mount('/', StaticFiles(directory=str(_webapp_dist), html=True), name='webapp')
