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

from fastapi import FastAPI, Form, BackgroundTasks, UploadFile, File, HTTPException
from fastapi.responses import PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from twilio.rest import Client as TwilioClient
from twilio.twiml.messaging_response import MessagingResponse
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from pathlib import Path

# Load .env from project root regardless of working directory
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env', override=True)

sys.path.insert(0, os.path.dirname(__file__))

from moneybook_db import (
    init_db,
    get_or_create_store, get_store_by_phone, update_store, get_all_active_stores,
    get_bot_state, set_bot_state, clear_bot_state,
    add_transaction,
    get_person, save_person, get_unknown_persons,
    get_daily_summary, get_period_summary, get_udhaar_outstanding,
    get_udhaar_aging, get_weekly_summary,
    save_correction, build_store_context,
    get_store_segment, promote_correction,
    save_web_message, get_web_messages,
    get_daily_trend, get_staff_payments, get_payment_mode_split,
    get_top_receivers, get_dues_with_detail, get_staff_detail,
    update_udhaar_contact,
    update_message_metadata, delete_transaction,
    get_person_udhaar_history,
    update_web_message_body,
)
from moneybook_parser import (
    parse_text_message, parse_image_message, parse_correction,
    classify_correction_scope, is_trackable_person,
    format_pending_confirmation, format_person_question,
    format_daily_summary, format_period_summary, format_udhaar_list,
    TAG_META,
)

TWILIO_ACCOUNT_SID     = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN      = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_WHATSAPP_NUMBER = os.getenv('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+14155238886')

twilio = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('moneybook')

app = FastAPI(title='MoneyBook', version='2.0')

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
    'textile':     '👗 Textile / Clothing',
    'grocery':     '🛒 Grocery / Kirana',
    'pharmacy':    '💊 Pharmacy / Medicine',
    'hardware':    '🔧 Hardware / Tools',
    'food':        '🍱 Food / Restaurant',
    'electronics': '📱 Electronics',
    'general':     '🏪 General / Other',
}

_SEGMENT_MSG_EN = (
    "What type of business do you have?\n\n"
    "1️⃣ Textile / Clothing\n"
    "2️⃣ Grocery / Kirana\n"
    "3️⃣ Pharmacy / Medicine\n"
    "4️⃣ Hardware / Tools\n"
    "5️⃣ Food / Restaurant\n"
    "6️⃣ Electronics\n"
    "7️⃣ Other\n\n"
    "_(Send a number — 1 to 7)_"
)

def _get_segment_msg(language: str = 'hinglish') -> str:
    return _translate(_SEGMENT_MSG_EN, language)

PERSON_LABELS = {
    'staff':    '👷 Staff/Employee',
    'customer': '🛒 Customer',
    'supplier': '📦 Supplier/Party',
    'home':     '🏠 Home/Personal',
}

# ─────────────────────────────────────────────
# Dynamic Language Translation
# All bot strings are written in English.
# For non-English languages, Claude Haiku
# translates them on the fly and caches the
# result — no hardcoded per-language strings.
# ─────────────────────────────────────────────

import threading as _threading
import anthropic as _anthropic

_anthropic_client = _anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
_translation_cache: dict = {}
_translation_lock = _threading.Lock()


def _translate(text: str, language: str) -> str:
    """
    Translate any bot message to the chosen language using Claude Haiku.
    - 'english' and 'hinglish': returned as-is (text is already in English/Hinglish).
    - All other languages: translated via Haiku, result cached in memory.
    Formatting rules preserved: emojis, *bold*, _italic_, ₹, numbers, /commands.
    Falls back to original text if the API call fails.
    """
    if not language or language == 'english':
        return text

    # Use first 300 chars as cache key (long texts may vary in whitespace)
    cache_key = (language, text[:300])
    with _translation_lock:
        cached = _translation_cache.get(cache_key)
    if cached:
        return cached

    try:
        response = _anthropic_client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=800,
            messages=[{
                'role': 'user',
                'content': (
                    f'Translate the following chat message to {language}.\n'
                    'Rules (follow exactly):\n'
                    '- Preserve all emojis exactly as they appear\n'
                    '- Preserve markdown: *bold* and _italic_ wrappers unchanged\n'
                    '- Preserve ₹ symbol and all numbers unchanged\n'
                    '- Preserve /commands like /summary, /help unchanged\n'
                    '- Preserve newlines and bullet structure\n'
                    '- Return ONLY the translated message — no explanation, no prefix\n\n'
                    f'Message:\n{text}'
                )
            }]
        )
        translated = response.content[0].text.strip()
        with _translation_lock:
            _translation_cache[cache_key] = translated
        log.debug(f'Translated to {language}: {text[:60]!r} → {translated[:60]!r}')
        return translated
    except Exception as e:
        log.warning(f'Translation failed (lang={language}): {e}')
        return text  # graceful fallback


# ── Base strings in English — dynamically translated at runtime for every language ──
# Zero per-language hardcoding. _translate() handles ALL languages via Claude Haiku.

_BASE = {
    'image_ack':         '📷 Photo received! Reading it... please wait a moment ⏳',
    'image_not_found':   "Couldn't find anything in the photo 🤔\nPlease send a clearer photo or type it manually.",
    'image_error':       '⚠️ Error processing the photo. Please try again.\n({detail})',
    'welcome':           '🏪 *Welcome to MoneyBook!*\n\nWhat is your store name?',
    'name_thanks':       '✅ *{name}* — great name!',
    'cancel_msg':        '❌ Cancelled. Send a new entry.',
    'saved_all':         '✅ *{n} entries saved!*\n\nReady for next entry 📒',
    'not_understood':    (
        "Didn't understand 🤔\n\n"
        "• *yes* → Save all\n"
        "• *wrong 3* → Fix entry 3\n"
        "• *3 tag electricity* → Change tag of entry 3\n"
        "• *cancel* → Cancel"
    ),
    'fix_entry_prompt':  (
        "✏️ *Fix entry {n}:*\n"
        "_{desc} — ₹{amount}_\n\n"
        "Send the correct info\n"
        "_(e.g. 'amount was 750' or 'this was a credit entry')_"
    ),
    'entry_not_found':   'Entry {n} not found. Send a number between 1 and {total}.',
    'tag_updated':       '🏷️ Entry {n} tag updated: {emoji} _{label}_',
    'tag_not_found':     "Tag '{tag}' not found.\nAvailable tags:\n{tags}",
    'correction_saved':  (
        '✅ Entry {n} updated:\n'
        '_{desc} — ₹{amount} {emoji}_\n\n'
        '_{scope_emoji} Learned ({scope_label}) — will get it right next time_ 🧠'
    ),
    'classify_invalid':  'Please choose from 1, 2, 3, or 4:\n{options}',
    'person_saved':      '✅ *{name}* → {label}\n\n',
    'all_classified':    'Everyone registered! 🎉\nReady for next entry 📒',
    'save_single':       '✅ Saved: {desc} — ₹{amount}\n   {emoji} _{label}_',
    'no_amount':         "No amount found 🤔\nTry: 'Sale 5000' or send a notebook photo.\nType /help for commands.",
}


def _t(key: str, language: str = 'hinglish', **kwargs) -> str:
    """
    Look up an English base string, apply any format kwargs, then
    dynamically translate to the requested language via Claude Haiku.
    Every language — including hinglish — goes through _translate().
    """
    base = _BASE.get(key, key)
    text = base.format(**kwargs) if kwargs else base
    return _translate(text, language)


# Universal confirm/cancel words — covers all languages.
# The bot also tells users what to type in their own language,
# so most users will type one of the universal words anyway.
_CONFIRM_WORDS = {'haan', 'han', 'yes', 'ok', 'okay', 'sahi', '✅', 'haan sahi',
                  'हाँ', 'हां', 'हा', 'हो', 'હા', 'confirm', 'save'}
_CANCEL_WORDS  = {'cancel', 'रद्द', 'રદ', 'no', 'stop'}


_HELP_MSG_BASE = """\
🏪 *MoneyBook — Your Digital Account Book*

*Log transactions naturally:*
• Sale 5000 cash
• Raju ne 500 udhaar liya  _(credit given)_
• CD A. Tiwari 695  _(Cash Discount)_
• Electricity bill 800
• Bank deposit 20000
• 📷 Send a photo of your notebook page

*Commands:*
• /summary  → Today's accounts (expenses by category + cash check)
• /month    → This month's summary
• /quarter  → This quarter's summary
• /year     → This year's summary
• /udhaar   → Outstanding credit list
• /help     → This message"""


def _get_help_msg(language: str = 'hinglish') -> str:
    return _translate(_HELP_MSG_BASE, language)

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


def run_command(action: str, store: dict, language: str = 'hinglish') -> str:
    from datetime import date as dt
    sid  = store['id']
    name = store.get('name', 'Store')

    if action == 'summary':
        return format_daily_summary(get_daily_summary(sid), name, language)

    if action == 'udhaar':
        return format_udhaar_list(get_udhaar_outstanding(sid), language)

    if action == 'month':
        today = dt.today()
        start = today.replace(day=1).isoformat()
        end   = today.isoformat()
        month_name = today.strftime('%B %Y')
        data  = get_period_summary(sid, start, end, label=month_name)
        return format_period_summary(data, name, language)

    if action == 'quarter':
        today = dt.today()
        q_start_month = ((today.month - 1) // 3) * 3 + 1
        start = today.replace(month=q_start_month, day=1).isoformat()
        end   = today.isoformat()
        q_num = (today.month - 1) // 3 + 1
        data  = get_period_summary(sid, start, end, label=f'Q{q_num} {today.year}')
        return format_period_summary(data, name, language)

    if action == 'year':
        today = dt.today()
        start = today.replace(month=1, day=1).isoformat()
        end   = today.isoformat()
        data  = get_period_summary(sid, start, end, label=f'Year {today.year}')
        return format_period_summary(data, name, language)

    return _get_help_msg(language)


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
    sid  = store['id']
    t    = body.strip().lower()
    lang = state.get('language', 'hinglish')

    pending      = state.get('pending', [])
    raw_message  = state.get('raw_message', '')
    source       = state.get('source', 'text')
    persons_found = state.get('persons_found', [])
    page_date    = state.get('page_date')
    persons_map  = state.get('persons_map', {})

    # ── Cancel ──────────────────────────────────────
    if t in _CANCEL_WORDS:
        clear_bot_state(sid)
        return _t('cancel_msg', lang)

    # ── Haan = save all ─────────────────────────────
    if t in _CONFIRM_WORDS:
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
                'language':       lang,
            })
            amt  = txn_for_person.get('amount', 0)
            desc = txn_for_person.get('description', '')
            return (
                _t('saved_all', lang, n=len(pending)) + '\n\n'
                + format_person_question(next_person, float(amt), desc, language=lang)
            )
        else:
            clear_bot_state(sid)
            return _t('saved_all', lang, n=len(pending))

    # ── Galat N = fix entry N ────────────────────────
    import re
    m = re.match(r'^galat\s+(\d+)$', t)
    if not m:
        m = re.match(r'^(\d+)\s+galat$', t)
    if not m:
        m = re.match(r'^wrong\s+(\d+)$', t)   # english alias
    if not m:
        m = re.match(r'^(\d+)\s+wrong$', t)
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
            return _t('fix_entry_prompt', lang,
                      n=idx+1,
                      desc=f"{entry.get('description','')} {emoji}",
                      amount=f"{float(entry['amount']):,.0f}")
        else:
            return _t('entry_not_found', lang, n=idx+1, total=len(pending))

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
                _t('tag_updated', lang, n=idx+1, emoji=emoji, label=label) + '\n\n'
                + format_pending_confirmation(pending, page_date, language=lang)
            )
        else:
            tag_list = ', '.join(TAG_META.keys())
            return _t('tag_not_found', lang, tag=new_tag, tags=tag_list)

    # ── Unrecognized ────────────────────────────────
    return (
        _t('not_understood', lang) + '\n\n'
        + format_pending_confirmation(pending, page_date, language=lang)
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

    lang = state.get('language', 'hinglish')
    scope_emoji = {'global': '🌐', 'segment': '🏪', 'store': '🔒'}.get(scope, '🔒')
    # Scope labels translated
    _scope_labels_en = {
        'global':  'for all stores',
        'segment': f'for {store_segment} stores',
        'store':   'for your store only',
    }
    scope_label = _translate(_scope_labels_en.get(scope, _scope_labels_en['store']), lang)
    log.info(f"Correction saved store={sid} entry={idx+1} scope={scope} segment={store_segment}")

    new_state = {**state, 'state': 'confirming', 'pending': pending}
    new_state.pop('correcting_index', None)
    set_bot_state(sid, new_state)

    tag   = corrected.get('tag', 'other')
    emoji = TAG_META.get(tag, ('', '📝'))[1]
    return (
        _t('correction_saved', lang,
           n=idx+1,
           desc=corrected.get('description', ''),
           amount=f"{float(corrected['amount']):,.0f}",
           emoji=emoji,
           scope_emoji=scope_emoji,
           scope_label=scope_label)
        + '\n\n'
        + format_pending_confirmation(pending, state.get('page_date'), language=lang)
    )


# ─────────────────────────────────────────────
# State: CLASSIFYING
# Owner classifies a person (staff/customer/etc.)
# ─────────────────────────────────────────────

def handle_classifying(body: str, store: dict, state: dict) -> str:
    """Process person category choice and advance to next person or finish."""
    sid   = store['id']
    queue = state.get('persons_queue', [])
    idx   = state.get('person_index', 0)
    lang  = state.get('language', 'hinglish')

    choice = body.strip()
    if choice not in PERSON_CATEGORIES:
        names = '\n'.join([f"{k}️⃣ {v}" for k, v in PERSON_LABELS.items()])
        return _t('classify_invalid', lang, options=names)

    category  = PERSON_CATEGORIES[choice]
    name      = queue[idx]
    save_person(sid, name, category)

    label    = PERSON_LABELS[category]
    response = _t('person_saved', lang, name=name, label=label)

    # Advance to next unknown person
    idx += 1
    unknown_remaining = [n for n in queue[idx:] if not get_person(sid, n)]

    if unknown_remaining:
        next_name = unknown_remaining[0]
        next_idx  = queue.index(next_name)
        set_bot_state(sid, {**state, 'person_index': next_idx})
        return response + format_person_question(next_name, 0, '', language=lang)
    else:
        clear_bot_state(sid)
        return response + _t('all_classified', lang)


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
        store = get_or_create_store(from_number)
        sid   = store['id']
        lang  = get_bot_state(sid).get('language', 'hinglish')

        ctx           = build_store_context(sid)   # per-store learning context
        parsed        = parse_image_message(media_url, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
                                            store_context=ctx)
        txns          = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
        persons_found = parsed.get('persons_found', [])
        page_date     = parsed.get('date')
        raw_ocr       = parsed.get('raw_ocr', '')

        if not txns:
            ocr_conf = parsed.get('ocr_confidence', 'high')
            if raw_ocr and ocr_conf in ('low', 'medium'):
                reply = (parsed.get('response_message') or
                         _t('image_not_found', lang) +
                         f"\n\n*{raw_ocr[:400]}*")
            else:
                reply = (parsed.get('response_message') or _t('image_not_found', lang))
        else:
            set_bot_state(sid, {
                'state':         'confirming',
                'pending':       txns,
                'persons_found': persons_found,
                'persons_map':   {},
                'raw_message':   body,
                'source':        'image',
                'page_date':     page_date,
                'raw_ocr':       raw_ocr,
                'language':      lang,
            })
            reply = format_pending_confirmation(txns, page_date, language=lang)

        send_whatsapp(from_number, reply)
        log.info(f"Image processed for {from_number}: {len(txns)} transactions found")
    except Exception as e:
        log.error(f"Background image processing failed: {e}")
        send_whatsapp(from_number, _t('image_error', lang if 'lang' in dir() else 'hinglish',
                                      detail=str(e)[:100]))


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

    store = get_or_create_store(from_number)
    sid   = store['id']

    # ── Onboarding ───────────────────────────────────────
    wa_lang = get_bot_state(sid).get('language', 'hinglish')
    if store['onboarding_state'] == 'new':
        update_store(sid, onboarding_state='awaiting_name')
        return twiml_reply(_t('welcome', wa_lang))

    if store['onboarding_state'] == 'awaiting_name':
        name = body or 'My Store'
        update_store(sid, name=name, onboarding_state='awaiting_segment')
        return twiml_reply(_t('name_thanks', wa_lang, name=name) + '\n\n' + _get_segment_msg(wa_lang))

    if store['onboarding_state'] == 'awaiting_segment':
        choice  = body.strip()
        segment = SEGMENT_CHOICES.get(choice, 'general')
        label   = SEGMENT_LABELS[segment]
        update_store(sid, segment=segment, onboarding_state='active')
        return twiml_reply(_translate(
            f"✅ Segment set: *{label}*\n\nFrom now I'll understand entries for your business type.\n\n"
            + _HELP_MSG_BASE, wa_lang
        ))

    # ── Image: respond instantly, process in background ──
    # Twilio has a 15-second webhook timeout. Image download + Gemini Vision
    # takes 20-30s, so we must return immediately and push the reply later.
    if has_media:
        wa_lang = get_bot_state(sid).get('language', 'hinglish')
        background_tasks.add_task(process_image_and_reply, from_number, MediaUrl0, body)
        return twiml_reply(_t('image_ack', wa_lang))

    # ── Conversation state machine (text only below) ─────
    bot_state = get_bot_state(sid)
    current   = bot_state.get('state', 'idle')

    # Commands always interrupt current state
    if detect_command(body) in ('help', 'summary', 'udhaar', 'month', 'quarter', 'year'):
        clear_bot_state(sid)
        return twiml_reply(run_command(detect_command(body), store, language=wa_lang))

    if current == 'confirming':
        return twiml_reply(handle_confirming(body, store, bot_state))

    if current == 'correcting':
        return twiml_reply(handle_correcting(body, store, bot_state))

    if current == 'classifying':
        return twiml_reply(handle_classifying(body, store, bot_state))

    # ── Idle: commands ───────────────────────────────────
    action = detect_command(body)
    if action:
        return twiml_reply(run_command(action, store, language=wa_lang))

    # ── Idle: parse text transaction ─────────────────────
    ctx           = build_store_context(sid)
    parsed        = parse_text_message(body, store_context=ctx, language=wa_lang)
    txns          = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
    persons_found = parsed.get('persons_found', [])
    page_date     = parsed.get('date')

    if not txns:
        return twiml_reply(parsed.get('response_message') or _t('no_amount', wa_lang))

    # Single transaction → auto-save immediately
    if len(txns) == 1:
        t = txns[0]
        add_transaction(sid, t, raw_message=body, source='text')
        tag   = t.get('tag', 'other')
        emoji = TAG_META.get(tag, ('', '📝'))[1]
        label = TAG_META.get(tag, ('', '📝'))[0]
        reply = _t('save_single', wa_lang,
                   desc=t.get('description', ''),
                   amount=f"{float(t['amount']):,.0f}",
                   emoji=emoji, label=label)
        if (t.get('person_name') and t.get('needs_tracking', False)
                and not get_person(sid, t['person_name'])):
            set_bot_state(sid, {'state': 'classifying', 'language': wa_lang,
                                'persons_queue': [t['person_name']], 'person_index': 0})
            reply += '\n\n' + format_person_question(
                t['person_name'], float(t['amount']), t.get('description', ''), language=wa_lang)
        return twiml_reply(reply)

    # Multiple transactions → show confirmation list
    set_bot_state(sid, {
        'state': 'confirming', 'pending': txns,
        'persons_found': persons_found, 'persons_map': {},
        'raw_message': body, 'source': 'text', 'page_date': page_date,
        'language': wa_lang,
    })
    return twiml_reply(format_pending_confirmation(txns, page_date, language=wa_lang))


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
        state    = get_bot_state(store['id']) or {}
        lang     = state.get('language', 'hinglish')
        data     = get_daily_summary(store['id'])
        msg      = format_daily_summary(data, store.get('name', 'Store'), lang)
        msg     += "\n\n_📒 MoneyBook Daily Report_"
        send_whatsapp(store['phone'], msg)


def job_udhaar_alerts():
    log.info("⏰ Udhaar alerts...")
    for store in get_all_active_stores():
        aging = get_udhaar_aging(store['id'], days=30)
        if not aging:
            continue
        state = get_bot_state(store['id']) or {}
        lang  = state.get('language', 'hinglish')
        total = sum(u['balance'] for u in aging)
        header_en = f"⚠️ *Old Credit Alert — {store.get('name','')}*\n"
        lines = [_translate(header_en, lang)]
        for u in aging:
            days = (date.today() - date.fromisoformat(u['last_transaction_date'])).days
            lines.append(f"• {u['person_name']}: ₹{u['balance']:,.0f} ({days} days)")
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
    transactions: list            # final (possibly edited) transactions
    bot_message_id: int = None
    original_transactions: list = None  # AI-parsed originals, for diff-based learning

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
        replies = ['yes']
        for i in range(min(len(pending), 5)):
            replies.append(f'wrong {i+1}')
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

    # ── Onboarding ────────────────────────────────────────
    if store['onboarding_state'] == 'new':
        update_store(sid, onboarding_state='awaiting_name')
        reply = _t('welcome', language)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    if store['onboarding_state'] == 'awaiting_name':
        name = body.strip() or 'My Store'
        update_store(sid, name=name, onboarding_state='awaiting_segment')
        reply = _t('name_thanks', language, name=name) + '\n\n' + _get_segment_msg(language)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    if store['onboarding_state'] == 'awaiting_segment':
        choice  = body.strip()
        segment = SEGMENT_CHOICES.get(choice, 'general')
        label   = SEGMENT_LABELS[segment]
        update_store(sid, segment=segment, onboarding_state='active')
        reply = _translate(
            f"✅ Segment set: *{label}*\n\nFrom now I'll understand entries for your business type.\n\n"
            + _HELP_MSG_BASE, language
        )
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    # ── Commands always interrupt state ──────────────────
    action = detect_command(body)
    if action in ('help', 'summary', 'udhaar', 'month', 'quarter', 'year'):
        clear_bot_state(sid)
        reply = run_command(action, store, language=language)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    # ── Conversation state machine ────────────────────────
    bot_state = get_bot_state(sid)
    # Always keep language fresh in bot_state so handlers can read it
    bot_state['language'] = language
    set_bot_state(sid, bot_state)
    current = bot_state.get('state', 'idle')

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
        if body.strip().lower() in _CANCEL_WORDS:
            clear_bot_state(sid)
            return {'reply': _t('cancel_msg', language), 'quick_replies': [], 'processing': False}
        reply = handle_classifying(body, store, bot_state)
        new_state = get_bot_state(sid)
        qr = _quick_replies_for_state(new_state, new_state.get('pending', []))
        return {'reply': reply, 'quick_replies': qr, 'processing': False}

    # ── Idle: parse text transaction ─────────────────────
    ctx    = build_store_context(sid)
    parsed = parse_text_message(body, store_context=ctx, language=language)
    txns   = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
    persons_found = parsed.get('persons_found', [])
    page_date = parsed.get('date')

    if not txns:
        reply = parsed.get('response_message') or _t('no_amount', language)
        return {'reply': reply, 'quick_replies': [], 'processing': False}

    if len(txns) == 1:
        t = txns[0]
        add_transaction(sid, t, raw_message=body, source='text')
        tag   = t.get('tag', 'other')
        emoji = TAG_META.get(tag, ('', '📝'))[1]
        label = TAG_META.get(tag, ((tag or 'other').replace('_',' ').title(), '📝'))[0]
        reply = _t('save_single', language,
                   desc=t.get('description', ''),
                   amount=f"{float(t['amount']):,.0f}",
                   emoji=emoji, label=label)
        if (t.get('person_name') and t.get('needs_tracking', False)
                and not get_person(sid, t['person_name'])):
            set_bot_state(sid, {'state': 'classifying', 'language': language,
                                'persons_queue': [t['person_name']], 'person_index': 0})
            reply += '\n\n' + format_person_question(t['person_name'], float(t['amount']),
                                                     t.get('description', ''), language=language)
            return {'reply': reply, 'quick_replies': ['1','2','3','4'], 'processing': False,
                    'pending_transactions': [t]}
        return {'reply': reply, 'quick_replies': [], 'processing': False,
                'pending_transactions': [t]}

    # Multiple transactions → confirmation
    set_bot_state(sid, {
        'state': 'confirming', 'pending': txns,
        'persons_found': persons_found, 'persons_map': {},
        'raw_message': body, 'source': 'text', 'page_date': page_date,
        'language': language,
    })
    reply = format_pending_confirmation(txns, page_date, language=language)
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
    """Upload a notebook image. Saves it, starts background processing."""
    store = get_or_create_store(phone)
    sid   = store['id']

    # Save file to .tmp/uploads/
    uploads_dir = Path(__file__).parent.parent / '.tmp' / 'uploads'
    uploads_dir.mkdir(parents=True, exist_ok=True)
    ext      = Path(file.filename or 'image.jpg').suffix or '.jpg'
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = uploads_dir / filename
    contents = await file.read()
    filepath.write_bytes(contents)

    media_url = f"/uploads/{filename}"

    # Save user message (image)
    user_msg_id = save_web_message(sid, 'user', body=None, media_url=media_url)

    # Save ack in English immediately (no blocking). Background task translates it.
    ack_id = save_web_message(sid, 'bot', _BASE['image_ack'])

    # Mark processing in bot_state (also persist language choice)
    current_state = get_bot_state(sid)
    set_bot_state(sid, {**current_state, 'processing_image': True, 'language': language})

    # Background: translate ack + parse image + save reply
    background_tasks.add_task(
        _process_web_image, phone, sid, str(filepath),
        file.content_type or 'image/jpeg', media_url, language, ack_id
    )

    return {
        'user_message_id': user_msg_id,
        'processing': True,
    }


def _process_web_image(phone: str, store_id: int, filepath: str,
                       mime_type: str, media_url: str, language: str = 'hinglish',
                       ack_id: int = None):
    """Background: parse a locally-saved image and push reply to web_messages."""
    try:
        # Translate ack text now (safe in background thread — blocking call is fine here)
        if ack_id:
            update_web_message_body(ack_id, _t('image_ack', language))
        ctx    = build_store_context(store_id)
        parsed = parse_image_message(
            image_url=None,
            local_path=filepath,
            local_mime=mime_type,
            store_context=ctx,
            language=language,
        )
        txns          = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
        persons_found = parsed.get('persons_found', [])
        page_date     = parsed.get('date')

        if not txns:
            reply = (parsed.get('response_message') or _t('image_not_found', language))
            save_web_message(store_id, 'bot', reply)
        else:
            store = get_or_create_store(phone)
            set_bot_state(store_id, {
                'state':         'confirming',
                'pending':       txns,
                'persons_found': persons_found,
                'persons_map':   {},
                'raw_message':   '',
                'source':        'image',
                'page_date':     page_date,
                'raw_ocr':       parsed.get('raw_ocr', ''),
                'language':      language,
            })
            reply   = format_pending_confirmation(txns, page_date, language=language)
            qr      = ['yes'] + [f'wrong {i+1}' for i in range(min(len(txns), 5))] + ['cancel']
            display = parsed.get('display', None)
            # Overwrite any previous unconfirmed ConfirmCard so only latest photo shows
            old_msgs = get_web_messages(store_id, after_id=0, limit=30)
            for om in old_msgs:
                if om.get('direction') == 'bot' and (om.get('metadata') or {}).get('pending_transactions'):
                    update_message_metadata(om['id'], {'overwritten': True})
            # Save new ConfirmCard — include display layout so UI mirrors the notebook
            save_web_message(store_id, 'bot', reply, quick_replies=qr,
                             metadata={
                                 'pending_transactions': txns,
                                 'page_date':            page_date,
                                 'display':              display,
                             })
            log.info(f"Web image processed for store {store_id}: {len(txns)} transactions")

    except Exception as e:
        log.error(f"Web image processing failed: {e}")
        save_web_message(store_id, 'bot',
                         _t('image_error', language, detail=str(e)[:80]))
    finally:
        # Clear processing flag
        try:
            current = get_bot_state(store_id)
            current.pop('processing_image', None)
            set_bot_state(store_id, current)
        except Exception:
            pass


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


@app.post('/api/confirm')
async def api_confirm(req: ConfirmRequest):
    """Save (possibly edited) transactions from the confirm card UI."""
    store = get_or_create_store(req.phone)
    sid   = store['id']

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
            'current_idx':   0,
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
async def api_analytics(phone: str, period: str = 'day',
                        start: Optional[str] = None, end: Optional[str] = None):
    """Returns analytics data for the given period or custom date range.
    If start/end are provided they override the period preset.
    """
    store = get_or_create_store(phone)
    sid = store['id']
    today = date.today()

    if start and end:
        # Custom range — use as-is (frontend sends YYYY-MM-DD)
        pass
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
    ctx      = build_store_context(store['id'])
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
        parsed = parse_text_message(message, store_context=ctx, language=language)
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
            person  = t.get('person_name') or src.get('person_name', '')
            if section != 'general' and person:
                cat = 'staff' if section == 'staff' else ('customer' if section == 'dues' else 'supplier')
                save_person(store['id'], person, cat)
                t['needs_tracking'] = False
                t['person_category'] = cat
            elif section != 'general':
                # Even without person name, skip classification for sectioned rows
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
async def api_dues(phone: str):
    """Returns udhaar list with transaction details."""
    store = get_or_create_store(phone)
    sid   = store['id']
    dues  = get_dues_with_detail(sid)
    return {'dues': dues}


@app.post('/api/dues/contact')
async def api_update_contact(req: UpdateContactRequest):
    """Save contact number for a person in udhaar table."""
    store = get_or_create_store(req.phone)
    sid   = store['id']
    update_udhaar_contact(sid, req.person_name, req.contact_phone)
    return {'ok': True}


@app.get('/api/staff')
async def api_staff(phone: str):
    """Returns staff payment summary."""
    store = get_or_create_store(phone)
    sid   = store['id']
    staff = get_staff_detail(sid)
    return {'staff': staff}



@app.get('/api/profile')
async def api_profile(phone: str):
    """Return store profile info."""
    store = get_store_by_phone(phone)
    if not store:
        raise HTTPException(status_code=404, detail='Store not found')
    state    = get_bot_state(store['id']) or {}
    language = state.get('language', store.get('language', 'hinglish'))
    return {
        'name':     store.get('name', ''),
        'phone':    phone,
        'segment':  store.get('segment', 'general'),
        'language': language,
        'joined':   store.get('created_at', ''),
    }


class ProfileUpdateRequest(BaseModel):
    phone:    str
    name:     Optional[str] = None
    language: Optional[str] = None

@app.post('/api/profile')
async def api_profile_update(req: ProfileUpdateRequest):
    """Update store name and/or language."""
    store = get_store_by_phone(req.phone)
    if not store:
        raise HTTPException(status_code=404, detail='Store not found')
    sid = store['id']
    if req.name is not None:
        update_store(sid, name=req.name.strip())
    if req.language is not None:
        state = get_bot_state(sid) or {}
        state['language'] = req.language
        set_bot_state(sid, state)
    return {'ok': True}


# ── Serve uploaded images ──────────────────────────────────────
_uploads_dir = Path(__file__).parent.parent / '.tmp' / 'uploads'
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount('/uploads', StaticFiles(directory=str(_uploads_dir)), name='uploads')

# ── Serve React webapp (MUST be last — catches all remaining routes) ──
_webapp_dist = Path(__file__).parent.parent / 'webapp' / 'dist'
if _webapp_dist.exists():
    app.mount('/', StaticFiles(directory=str(_webapp_dist), html=True), name='webapp')
