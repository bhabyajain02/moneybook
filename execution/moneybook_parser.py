"""
MoneyBook — Parser (Claude-powered, Extended Thinking)
=======================================================
Single-pass vision with Extended Thinking for maximum accuracy.

How it works:
  1. Claude gets the raw image + a rich prompt
  2. Extended Thinking gives Claude a private scratchpad to reason BEFORE answering
     — exactly like how Claude thinks in chat: "this looks like Palledari which means
       loading charges... the 819 above 4850 is a reference note not an amount..."
  3. After thinking, Claude outputs structured JSON

Why this works better than plain JSON output:
  • Plain JSON output suppresses reasoning — forces the model to jump straight to answer
  • Extended thinking = same intelligence as Claude in chat
  • Handles unknown vocabulary, ambiguous handwriting, new ledger formats automatically
  • No need to add every new word to a dictionary — the model reasons from world knowledge

Per-store learning:
  Every correction is saved and injected as few-shot examples in future prompts.
"""

import base64
import json
import os
import re
import time
import httpx
import anthropic
from datetime import date
from dotenv import load_dotenv
from pathlib import Path

# Load .env from project root (parent of execution/)
_ENV_PATH = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=_ENV_PATH, override=True)

_api_key = os.getenv('ANTHROPIC_API_KEY')
if not _api_key:
    raise EnvironmentError(
        f"ANTHROPIC_API_KEY not found. Checked: {_ENV_PATH}\n"
        "Add it to your .env file."
    )

_client = anthropic.Anthropic(api_key=_api_key)

# ─────────────────────────────────────────────
# Dynamic language translation
# All bot strings are written in English.
# For non-English languages, Claude Haiku
# translates on the fly with in-memory cache.
# ─────────────────────────────────────────────
import threading as _threading
_translation_cache: dict = {}
_translation_lock = _threading.Lock()


def _translate(text: str, language: str) -> str:
    """Translate bot message to chosen language. 'english' → returned as-is."""
    if not language or language == 'english':
        return text
    cache_key = (language, text[:300])
    with _translation_lock:
        cached = _translation_cache.get(cache_key)
    if cached:
        return cached
    try:
        response = _client.messages.create(
            model='claude-haiku-4-5',
            max_tokens=800,
            messages=[{'role': 'user', 'content': (
                f'Translate the following message to {language}.\n'
                'Rules:\n'
                '- Preserve all emojis exactly\n'
                '- Preserve *bold* and _italic_ markers unchanged\n'
                '- Preserve ₹ symbol and all numbers unchanged\n'
                '- Preserve /commands unchanged\n'
                '- Preserve newlines and bullet structure\n'
                '- Return ONLY the translated message\n\n'
                f'Message:\n{text}'
            )}]
        )
        translated = response.content[0].text.strip()
        with _translation_lock:
            _translation_cache[cache_key] = translated
        return translated
    except Exception:
        return text  # graceful fallback

# Models
_TEXT_MODEL      = 'claude-haiku-4-5'    # fast + cheap for simple text messages
_VISION_MODEL    = 'claude-opus-4-6'     # best available — most accurate for handwritten images
_VISION_FALLBACK = 'claude-sonnet-4-5'  # fallback if opus-4-6 unavailable

# Extended thinking budget (tokens the model can use to reason before answering)
# Higher = smarter but slower and more expensive
# 10000 for opus to handle complex multi-column, multi-entry ledger pages
_THINKING_BUDGET = 10000


# ─────────────────────────────────────────────────────────────
# Tag definitions  (tag → (display label, emoji))
# ─────────────────────────────────────────────────────────────

TAG_META = {
    'sale':             ('Bikri / Sale',          '💰'),
    'cash_discount':    ('Cash Discount',          '🏷️'),
    'electricity':      ('Bijli / Electricity',    '💡'),
    'transport':        ('Transport / Labour',     '🚚'),
    'dues':             ('Dues / Baki',            '📤'),
    'staff_salary':     ('Staff Salary',           '👷'),
    'office_supplies':  ('Office / Stationery',    '📎'),
    'cleaning':         ('Cleaning Supplies',      '🧹'),
    'bank':             ('Bank',                   '🏦'),
    'upi':              ('UPI',                    '📱'),
    'cash':             ('Cash',                   '💵'),
    'home_expense':     ('Ghar / Home',            '🏠'),
    'purchase':         ('Purchase / Kharidi',     '📦'),
    'opening':          ('Opening Balance',        '🔓'),
    'services':         ('Services / Kaam',        '🔧'),
    'food':             ('Food / Refreshment',     '☕'),
    'rent':             ('Rent / Kiraya',          '🏢'),
    'other':            ('Other',                  '📝'),
}

TAG_LIST = ', '.join(TAG_META.keys())


def tag_label(tag: str) -> str:
    """Return display label. For unknown tags, format the raw tag naturally."""
    if tag in TAG_META:
        return TAG_META[tag][0]
    # Unknown tag → display it naturally: 'staff_salary' → 'Staff Salary'
    return tag.replace('_', ' ').title() if tag else 'Other'

def tag_emoji(tag: str) -> str:
    """Return emoji. For unknown tags, return 📝 (neutral)."""
    return TAG_META.get(tag, ('', '📝'))[1]


# ─────────────────────────────────────────────────────────────
# Prompts
# ─────────────────────────────────────────────────────────────

_IMAGE_PARSE_PROMPT = """\
You are an expert accountant reading a handwritten Indian retail store cash book.
Use your full world knowledge — you already understand Indian business vocabulary,
regional terms, payment methods, and handwriting conventions across all business types.

TODAY: {today}
{store_context}

━━ YOUR TASK ━━
Find every financial entry in this image. The page can be in any format —
two columns, single column, tabular, date-wise, or mixed. Figure out the
structure from context. Extract every transaction regardless of layout.

Skip only rows that are clearly column totals (i.e. their value equals the
sum of entries above them). Everything else is a transaction.

━━ TRANSACTION TYPES — use exactly these names ━━
opening_balance  → starting cash / balance brought forward
closing_balance  → end-of-day cash carried forward
sale             → revenue from selling goods
receipt          → money received from a person (advance, collection, repayment)
expense          → outgoing payment that is NOT recoverable (bills, salary, rent, purchases)
udhaar_given     → credit given to a customer (they owe the store)
udhaar_received  → customer repaid their credit
bank_deposit     → cash moved to a bank account
cash_in_hand     → physical cash counted at day end
upi_in_hand      → UPI / Paytm / card settlement total at day end

━━ UDHAAR vs EXPENSE — KEY DISTINCTION ━━
udhaar_given: money given to someone expected to return it later (credit/advance/loan)
  → "Raju ne 500 liya", "X ko advance diya", "X ka dues diya", "udhaar diya"
udhaar_received: someone returning/paying back money owed to the store
  → "Raju ne paise wapas diye", "X ne dues bhara"
expense: money permanently spent on goods/services (NOT recoverable)
  → "bijli bill", "salary", "rent", "saman kharida", "freight"
When description says "dues" and money goes OUT to a named person → udhaar_given (they owe it back)

━━ TAG ━━
For expense entries write a short lowercase English label using your own world knowledge.
Be as specific as the context allows. Never write "other" — always describe what you see.
Non-expense types (sale, receipt, opening_balance, etc.) → tag: null

━━ DESCRIPTION — BE SPECIFIC ━━
Write a clear, specific English description that explains WHAT was transacted.
Include: what was sold/bought/paid, who was involved, context if mentioned.
BAD: "Sale transaction", "Expense payment", "Salary paid"
GOOD: "Rice and dal sold to Raju", "Electricity bill for March", "Monthly salary to Ramesh"
Keep under 60 characters. Use natural phrasing, not jargon.

━━ PERSON_NAME RULES ━━
person_name must be a real human's name (e.g. "Ramesh", "Vivek Singh", "A. Tiwari").
Set person_name=null for anything that is NOT a real human name:
- Generic words: "Manual", "Counter", "Cash", "Total", "Balance", "Online", "UPI"
- Transaction types: "Opening", "Closing", "Carry Forward", "Collection", "Adjustment"
- Payment methods: "Bank", "Credit", "Advance", "Transfer", "Deposit"
If the word could appear in a dictionary as a common noun/verb/adjective — it is NOT a person_name.

━━ NEEDS_TRACKING ━━
Set needs_tracking=true ONLY when person_name is a real human whose ongoing
business relationship should be tracked (staff on payroll, customer who owes money,
regular supplier).
Set needs_tracking=false when:
- person_name is a payment descriptor, method name, or transaction type
- The transaction is a store operational expense where the person is just a recipient
  (cash discount, refund, delivery charge, packaging cost, misc store expense)
- The person received a one-time payment that doesn't indicate an ongoing relationship
Key insight: "Cash discount given to X" means X is a customer getting a discount —
the store knows X is a customer from context. No need to track/ask.
"Bill payment to X" for goods/services is a routine expense — no tracking needed.
Only set needs_tracking=true when knowing the person's category (staff/customer/supplier)
would change how the transaction is recorded or reported.

━━ VERIFY YOUR WORK ━━
If any total or balance figure is written on the page, check that your
extracted entries sum to it. If they don't match, re-read before finalising.
Note any unresolved mismatches in skipped_entries.

━━ DISPLAY LAYOUT ━━
Also return a "display" object that captures the visual structure of the page
so the UI can render entries in the same format as the original notebook.

"layout": the dominant page format you see —
  "table"      → multiple named columns (Date | Particulars | In | Out)
  "two_column" → two side-by-side columns where each column contains independent entries
  "list"       → single column, one entry per line

"headers": the column header labels you can read or infer, in left→right order.
  Empty array [] if no headers are visible.

"rows": every data row on the page, top→bottom, left→right:
  "cells"      : text of each cell exactly as written (or your best OCR read)
  "txn_indices": array of 0-based indexes into the transactions array, one per cell.
                 Use null for a cell that is a heading, divider, running total, or blank.
                 IMPORTANT: txn_indices must have exactly the same length as cells.
                 CRITICAL: txn_indices[i] maps to cells[i] — the position MUST match.
                   If a row has only a right-column entry, cells=["", "60 Phenyl"] →
                   txn_indices=[null, 5]  NOT [5, null].
                   If only left column: cells=["1000 Ramesh", ""] → txn_indices=[2, null].
                 Example for a two-column row ["1000 Ramesh", "60 Phenyl"]:
                   "txn_indices": [2, 5]  ← cell[0]=txn[2], cell[1]=txn[5]

Keep cells short and faithful to what is written — do not paraphrase here.

━━ OUTPUT ━━
Produce your answer in <json> tags. Only content inside <json>...</json> is parsed.

<json>
{{
  "date": "<YYYY-MM-DD from page, else {today}>",
  "transactions": [
    {{
      "type": "<type from list above>",
      "amount": <number, no commas>,
      "description": "<clear English description>",
      "tag": "<specific lowercase label — null for non-expense types>",
      "person_name": "<name if mentioned, else null>",
      "person_category": null,
      "payment_mode": <"cash"|"upi"|"bank"|"credit"|null>,
      "date": "<YYYY-MM-DD>",
      "needs_tracking": <true if person_name is a real human to track, false otherwise>,
      "confidence": <integer 0-100: how clearly this entry was read and how certain the type/amount are>
    }}
  ],
  "display": {{
    "layout": "<table|two_column|list>",
    "headers": ["<col1>", "<col2>"],
    "rows": [
      {{ "cells": ["<text>", "<text>"], "txn_indices": [<int or null>, <int or null>] }}
    ]
  }},
  "persons_found": ["Name1", "Name2"],
  "response_message": "<N entries found, total IN ₹X, total OUT ₹Y>",
  "skipped_entries": "<anything ambiguous or unresolved>"
}}
</json>"""


_TEXT_PROMPT = """\
You are a financial transaction parser for Indian retail (kirana/wholesale) store owners.
Parse the message below and extract ALL financial transactions.

TODAY: {today}
MESSAGE: "{message}"

{store_context}

━━ TRANSACTION TYPES ━━
sale, expense, udhaar_given, udhaar_received, bank_deposit,
opening_balance, closing_balance, cash_in_hand, upi_in_hand, receipt

━━ IMPORTANT: CD = CASH DISCOUNT (not cash drawn) ━━
"CD A. Tiwari 695" → expense, tag: cash_discount, person: A. Tiwari, amount: 695

━━ UDHAAR vs EXPENSE — KEY DISTINCTION ━━
udhaar_given: money given to someone expected to return it later (credit/advance/loan)
  → "Raju ne 500 liya", "X ko advance diya", "X ka dues diya", "udhaar diya"
udhaar_received: someone returning/paying back money owed to the store
  → "Raju ne paise wapas diye", "X ne dues bhara"
expense: money permanently spent on goods/services (NOT recoverable)
  → "bijli bill", "salary", "rent", "saman kharida", "freight"
When description says "dues" and money goes OUT to a named person → udhaar_given (they owe it back)

━━ TAG — BE SPECIFIC, USE YOUR OWN WORDS ━━
Write a short lowercase English label describing the nature of the expense.
Do not pick from a fixed list — use your natural understanding.
Good examples: petrol, staff_salary, tailoring, freight, refreshment, electricity, rent, repair
Non-expense types → tag: null

━━ DESCRIPTION — BE SPECIFIC ━━
Write a clear, specific English description that explains WHAT was transacted.
Include: what was sold/bought/paid, who was involved, context if mentioned.
BAD: "Sale transaction", "Expense payment", "Salary paid"
GOOD: "Rice and dal sold to Raju", "Electricity bill for March", "Monthly salary to Ramesh", "Auto parts purchased for repair"
Keep under 60 characters. Use natural phrasing, not jargon.

━━ PERSON_NAME RULES ━━
person_name must be a real human's name (e.g. "Ramesh", "Vivek Singh", "A. Tiwari").
Set person_name=null for anything that is NOT a real human name:
- Generic words: "Manual", "Counter", "Cash", "Total", "Balance", "Online", "UPI"
- Transaction types: "Opening", "Closing", "Carry Forward", "Collection", "Adjustment"
- Payment methods: "Bank", "Credit", "Advance", "Transfer", "Deposit"
If the word could appear in a dictionary as a common noun/verb/adjective — it is NOT a person_name.

━━ NEEDS_TRACKING ━━
Set needs_tracking=true ONLY when person_name is a real human whose ongoing
business relationship should be tracked (staff on payroll, customer who owes money,
regular supplier).
Set needs_tracking=false when:
- person_name is a payment descriptor, method name, or transaction type
- The transaction is a store operational expense where the person is just a recipient
  (cash discount, refund, delivery charge, packaging cost, misc store expense)
- The person received a one-time payment that doesn't indicate an ongoing relationship
Key insight: "Cash discount given to X" means X is a customer getting a discount —
the store knows X is a customer from context. No need to track/ask.
"Bill payment to X" for goods/services is a routine expense — no tracking needed.
Only set needs_tracking=true when knowing the person's category (staff/customer/supplier)
would change how the transaction is recorded or reported.
For udhaar_given and udhaar_received: needs_tracking=true if person_name looks like a real name.

━━ OUTPUT — ONLY valid JSON ━━
{{
  "transactions": [
    {{
      "type": "<type>",
      "amount": <number>,
      "description": "<brief English description>",
      "tag": "<tag — REQUIRED>",
      "person_name": <"Name" or null>,
      "person_category": null,
      "payment_mode": <"cash"|"upi"|"bank"|"credit"|null>,
      "date": "<YYYY-MM-DD>",
      "needs_tracking": <true|false>
    }}
  ],
  "persons_found": ["Name1"],
  "detected_language": "<hindi|gujarati|english|mixed>",
  "response_message": "<confirmation in SAME language as input, list each entry with ₹>"
}}"""


_CORRECTION_PROMPT = """\
A store owner is correcting a single transaction entry that was wrongly parsed.

ORIGINAL ENTRY (what AI parsed):
{original}

OWNER'S CORRECTION: "{correction}"

Return ONLY the corrected transaction as JSON — same structure, only fix what changed:
{{
  "type": "<type>",
  "amount": <number>,
  "description": "<description>",
  "tag": "<tag — REQUIRED>",
  "person_name": <"Name" or null>,
  "person_category": null,
  "payment_mode": <"cash"|"upi"|"bank"|"credit"|null>,
  "date": "<YYYY-MM-DD>"
}}"""


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _clean_json(raw: str) -> str:
    raw = raw.strip()
    # Strip markdown code fences
    raw = re.sub(r'^```[a-z]*\n?', '', raw)
    raw = re.sub(r'\n?```$', '', raw)
    return raw.strip()


def _safe_parse(raw: str, fallback_msg: str) -> dict:
    """
    Parse JSON from Claude's response.
    Handles three formats:
      1. Content between <json>...</json> tags  (preferred — from extended thinking calls)
      2. Raw JSON string                         (fallback)
      3. JSON inside ```json fences              (Claude sometimes adds these)
    """
    # Try extracting from <json> tags first
    json_match = re.search(r'<json>(.*?)</json>', raw, re.DOTALL)
    if json_match:
        raw = json_match.group(1).strip()

    try:
        return json.loads(_clean_json(raw))
    except json.JSONDecodeError:
        return {'transactions': [], 'persons_found': [],
                'response_message': fallback_msg}


def _call_claude(model: str, prompt: str,
                 image_bytes: bytes = None, image_mime: str = None,
                 use_thinking: bool = False,
                 retries: int = 3) -> str:
    """
    Call Claude with optional image and optional extended thinking.

    use_thinking=True:
      Enables Claude's extended thinking — a private reasoning scratchpad
      before producing the final answer. This is what makes Claude in the API
      as smart as Claude in chat: it reasons through ambiguities, uses world
      knowledge to infer unknown vocabulary, cross-checks totals, etc.

      Cost: ~2-3x more tokens. Worth it for complex handwritten images.
      The thinking content is discarded — only the final text response is returned.

    Returns the text content of the response (thinking block excluded).
    """
    if image_bytes:
        content = [
            {
                'type': 'image',
                'source': {
                    'type': 'base64',
                    'media_type': image_mime or 'image/jpeg',
                    'data': base64.b64encode(image_bytes).decode('utf-8'),
                },
            },
            {'type': 'text', 'text': prompt},
        ]
    else:
        content = prompt

    for attempt in range(retries):
        try:
            if use_thinking:
                resp = _client.messages.create(
                    model=model,
                    max_tokens=16000,          # must be > thinking budget
                    thinking={
                        'type': 'adaptive',
                        'budget_tokens': _THINKING_BUDGET,
                    },
                    messages=[{'role': 'user', 'content': content}],
                )
                # Response has two blocks: thinking block + text block
                # We only want the text block (thinking is the model's private scratch)
                for block in resp.content:
                    if block.type == 'text':
                        return block.text
                # Fallback if no text block found
                return resp.content[-1].text

            else:
                resp = _client.messages.create(
                    model=model,
                    max_tokens=4096,
                    messages=[{'role': 'user', 'content': content}],
                )
                return resp.content[0].text

        except anthropic.RateLimitError:
            if attempt < retries - 1:
                wait = 15 * (2 ** attempt)   # 15s, 30s, 60s
                print(f'Claude rate limit — waiting {wait}s (attempt {attempt+1}/{retries})')
                time.sleep(wait)
            else:
                raise
        except anthropic.APIError as e:
            err = str(e)
            # Handle overloaded (529) with backoff
            if '529' in err or 'overloaded' in err.lower():
                if attempt < retries - 1:
                    wait = 10 * (2 ** attempt)
                    print(f'Claude overloaded — waiting {wait}s')
                    time.sleep(wait)
                    continue
            # Model not found → fall back to sonnet
            if 'not found' in err.lower() or 'model' in err.lower():
                if model == _VISION_MODEL and model != _VISION_FALLBACK:
                    print(f'Model {model} not found — falling back to {_VISION_FALLBACK}')
                    return _call_claude(_VISION_FALLBACK, prompt, image_bytes, image_mime,
                                        use_thinking=use_thinking, retries=retries)
            # If thinking isn't supported by this model version, retry without it
            if use_thinking and ('thinking' in err.lower() or 'not supported' in err.lower()):
                print(f'Extended thinking not supported — retrying without thinking')
                return _call_claude(model, prompt, image_bytes, image_mime,
                                    use_thinking=False, retries=retries - attempt)
            raise


# ─────────────────────────────────────────────────────────────
# Core parsers
# ─────────────────────────────────────────────────────────────

LANGUAGE_MAP = {
    'english':  'English',
    'hindi':    'Hindi (Devanagari script: हिंदी)',
    'hinglish': 'Hinglish (Hindi words written in Roman/English letters)',
    'gujarati': 'Gujarati (ગુજરાતી script)',
    'marathi':  'Marathi (मराठी script)',
    'bengali':  'Bengali (বাংলা script)',
    'tamil':    'Tamil (தமிழ் script)',
    'telugu':   'Telugu (తెలుగు script)',
    'kannada':  'Kannada (ಕನ್ನಡ script)',
    'punjabi':  'Punjabi (ਪੰਜਾਬੀ script)',
}

_LANGUAGE_INSTRUCTION = """\
LANGUAGE INSTRUCTION: You must respond ONLY in {language_name}.
For Hinglish: write Hindi words in Roman script (e.g. "Aaj ka hisaab", "Sale ho gayi").
For regional languages: use the correct script.
"""


def _build_language_instruction(language: str) -> str:
    lang_key = (language or 'hinglish').lower()
    lang_name = LANGUAGE_MAP.get(lang_key, LANGUAGE_MAP['hinglish'])
    return _LANGUAGE_INSTRUCTION.format(language_name=lang_name)


def parse_text_message(message: str, store_context: str = '', language: str = 'hinglish') -> dict:
    """Parse a free-form WhatsApp text message into transactions."""
    lang_instruction = _build_language_instruction(language)
    prompt = lang_instruction + '\n' + _TEXT_PROMPT.format(
        today=date.today().isoformat(),
        message=message,
        store_context=store_context,
    )
    try:
        text = _call_claude(_TEXT_MODEL, prompt)
        return _safe_parse(text,
            _translate("Couldn't understand 🙏\nExample: 'Sale 5000 cash' or 'Raju credit 500'", language))
    except anthropic.RateLimitError:
        return {'transactions': [], 'persons_found': [],
                'response_message': _translate('⚠️ AI is busy. Please try again in 1 minute.', language)}
    except Exception as e:
        return {'transactions': [], 'persons_found': [],
                'response_message': _translate(f'⚠️ Error: {str(e)[:80]}. Please try again.', language)}


def parse_image_message(image_url: str = None,
                        twilio_account_sid: str = None,
                        twilio_auth_token: str = None,
                        store_context: str = '',
                        local_path: str = None,
                        local_mime: str = None,
                        language: str = 'hinglish') -> dict:
    """
    Single-pass image parsing with Extended Thinking.

    Supports two image sources:
      - image_url: Twilio media URL (downloaded with auth)
      - local_path: local file path (used by web app uploads)

    Extended thinking lets Claude reason privately before producing JSON —
    the same internal process Claude uses when reading images in chat.
    """
    # ── Load image bytes ──────────────────────────────────
    try:
        if local_path:
            with open(local_path, 'rb') as f:
                image_bytes = f.read()
            image_mime = local_mime or 'image/jpeg'
        elif image_url:
            auth = (twilio_account_sid, twilio_auth_token) \
                   if twilio_account_sid and twilio_auth_token else None
            r = httpx.get(image_url, auth=auth, timeout=40, follow_redirects=True)
            r.raise_for_status()
            image_bytes = r.content
            image_mime  = r.headers.get('content-type', 'image/jpeg').split(';')[0]
        else:
            return {'transactions': [], 'persons_found': [],
                    'response_message': 'No image source provided'}
    except Exception as e:
        return {'transactions': [], 'persons_found': [],
                'response_message': f'Photo load error: {str(e)[:80]}'}

    try:
        lang_instruction = _build_language_instruction(language)
        prompt = lang_instruction + '\n' + _IMAGE_PARSE_PROMPT.format(
            today=date.today().isoformat(),
            store_context=store_context if store_context else
                         '(No prior corrections for this store yet)',
        )
        result_text = _call_claude(
            _VISION_MODEL, prompt,
            image_bytes=image_bytes, image_mime=image_mime,
            use_thinking=False,
        )
        result = _safe_parse(result_text,
            _translate("Couldn't read the photo 📷\nPlease send a clear photo in good lighting.", language))
        result['raw_ocr'] = '[single-pass with extended thinking]'
        return result

    except anthropic.RateLimitError:
        return {'transactions': [], 'persons_found': [],
                'response_message': _translate('⚠️ AI is busy. Please resend the photo in 2 minutes.', language)}
    except Exception as e:
        return {'transactions': [], 'persons_found': [],
                'response_message': f'Image error: {str(e)[:120]}'}


def parse_correction(original_txn: dict, correction_text: str) -> dict:
    """Re-parse a single corrected entry. Returns merged corrected transaction."""
    prompt = _CORRECTION_PROMPT.format(
        original=json.dumps(original_txn, ensure_ascii=False, indent=2),
        correction=correction_text,
    )
    try:
        text = _call_claude(_TEXT_MODEL, prompt)
        corrected = json.loads(_clean_json(text))
        return {**original_txn, **corrected}   # merge: only override changed fields
    except Exception:
        return original_txn   # fallback to original if parsing fails


# ─────────────────────────────────────────────────────────────
# 3-Tier correction classifier
# ─────────────────────────────────────────────────────────────

_CLASSIFY_PROMPT = """\
An Indian retail store owner corrected an AI parsing error.
Decide what SCOPE this correction belongs to.

Store segment: {segment}
Original (what AI parsed): {original}
Owner corrected it to:     {corrected}

SCOPE definitions:
  "global"  → Applies to ALL Indian retail stores regardless of business type.
               Examples: UPI/Paytm spelling variants, CD=Cash Discount,
               Indian number format, common payment methods.

  "segment" → Applies only to stores in the SAME business as "{segment}".
               Examples (textile): Saree, Bhada, Palledari, Dhulai (washing).
               Examples (grocery): dal brand names, sabzi prices, mandi.
               Examples (pharmacy): medicine names, generic→brand.
               Would NOT apply to unrelated segments.

  "store"   → Specific to THIS store only. Never apply elsewhere.
               Examples: person names (Anup Tiwari=staff), this store's
               shorthand codes, specific suppliers only this store uses.

Return ONLY valid JSON, no explanation:
{{"scope": "global" | "segment" | "store"}}
"""


_IS_PERSON_PROMPT = """\
An AI parsed a financial transaction from an Indian retail store notebook and extracted a person_name.
Decide whether this is a real human whose business relationship should be tracked.

Transaction context:
  person_name : "{name}"
  description : "{description}"
  type        : "{txn_type}"
  amount      : {amount}

Answer YES if "{name}" is clearly a real person (staff member, customer, supplier, family member).
Answer NO if "{name}" is any of:
  - A common word / transaction descriptor (Manual, Counter, Cash, Total, Balance, Collection)
  - A payment method or channel (UPI, Online, Bank, Credit, Advance)
  - Part of the description that was mistakenly extracted as a name
  - Ambiguous enough that it could easily be a descriptor rather than a person
  - A person receiving a routine store expense (cash discount, refund, return, delivery)
    where their category (staff/customer/supplier) doesn't affect how the entry is recorded
  - The description implies a standard business transaction (discount, bill payment,
    refund, goods return) rather than an ongoing tracked relationship (salary, dues, credit)

When in doubt, answer NO — it's better to skip than to ask about a non-person.

Reply with a single JSON object, no explanation:
{{"is_person": true | false, "reason": "<one short sentence>"}}
"""


def is_trackable_person(name: str, description: str, txn_type: str, amount: float = 0) -> bool:
    """
    Use Haiku to decide whether a person_name extracted from a transaction
    is a real human worth classifying, or just a descriptor/noise.

    Returns True only if the name is clearly a real person.
    Defaults to False on any error — never spam the user with bad questions.
    """
    prompt = _IS_PERSON_PROMPT.format(
        name=name,
        description=description or '',
        txn_type=txn_type or '',
        amount=amount or 0,
    )
    try:
        text = _call_claude(_TEXT_MODEL, prompt)
        result = json.loads(_clean_json(text))
        verdict = result.get('is_person', False)
        return bool(verdict)
    except Exception as e:
        print(f"is_trackable_person failed for {name!r}: {e}")
        return False   # safe default: never ask about something uncertain


def classify_correction_scope(original_txn: dict, corrected_txn: dict,
                               store_segment: str = 'general') -> str:
    """
    Use Haiku to classify whether a correction is store-specific, segment-specific,
    or universal. Returns 'global' | 'segment' | 'store'.

    This is what powers the 3-tier learning system:
      - global corrections benefit all stores immediately
      - segment corrections benefit all stores in the same industry
      - store corrections stay private to that store
    """
    prompt = _CLASSIFY_PROMPT.format(
        segment=store_segment,
        original=json.dumps(original_txn, ensure_ascii=False),
        corrected=json.dumps(corrected_txn, ensure_ascii=False),
    )
    try:
        text = _call_claude(_TEXT_MODEL, prompt)
        result = json.loads(_clean_json(text))
        scope = result.get('scope', 'store')
        return scope if scope in ('global', 'segment', 'store') else 'store'
    except Exception:
        return 'store'   # safe default: never over-share


# ─────────────────────────────────────────────────────────────
# WhatsApp message formatters
# ─────────────────────────────────────────────────────────────

def format_pending_confirmation(transactions: list, page_date: str = None, language: str = 'hinglish') -> str:
    """Format a pending transaction list for confirmation.
    Web UI uses ConfirmCard and hides this text — this is shown on WhatsApp only.
    """
    date_str   = f' ({page_date})' if page_date else ''
    n          = len(transactions)
    header_en  = f'{n} entries read{date_str}:'
    footer_en  = '✅ *yes* · ✏️ *wrong N* · ❌ *cancel*'
    header     = f'📋 *{_translate(header_en, language)}*\n'
    footer     = _translate(footer_en, language)
    lines      = [header]

    _TYPE_META = {
        'opening_balance':  ('🔓', 'Opening Bal'),
        'closing_balance':  ('🔒', 'Closing Bal'),
        'sale':             ('💰', 'Sale'),
        'receipt':          ('📨', 'Receipt'),
        'udhaar_given':     ('📤', 'Udhaar Diya'),
        'udhaar_received':  ('📥', 'Udhaar Mila'),
        'bank_deposit':     ('🏦', 'Bank Deposit'),
        'cash_in_hand':     ('💵', 'Cash'),
        'upi_in_hand':      ('📱', 'UPI'),
    }

    for i, t in enumerate(transactions, 1):
        tag      = t.get('tag') or 'other'
        txn_type = t.get('type', '')
        if txn_type in _TYPE_META:
            emoji, label = _TYPE_META[txn_type]
        else:
            emoji = tag_emoji(tag)
            label = tag_label(tag)

        desc   = t.get('description', '').strip()
        person = (t.get('person_name') or '').strip()
        # Only append person if not already mentioned in description
        if person and person.lower() not in desc.lower():
            desc = f'{desc} ({person})'

        lines.append(f'{i}. {emoji} {desc} — *₹{float(t["amount"]):,.0f}*')

    lines.append('\n' + footer)
    return '\n'.join(lines)


def format_person_question(name: str, amount: float, description: str, language: str = 'hinglish') -> str:
    """Ask the store owner to classify a new person. Dynamically translated."""
    base = (
        f'👤 *{name}* — who is this?\n'
        f'_(₹{amount:,.0f} — {description})_\n\n'
        '1️⃣ Staff / Employee\n'
        '2️⃣ Customer\n'
        '3️⃣ Supplier / Party\n'
        '4️⃣ Home / Personal expense\n\n'
        'Send number (1/2/3/4)'
    )
    return _translate(base, language)


def format_daily_summary(data: dict, store_name: str = 'Store', language: str = 'hinglish') -> str:
    s    = data['summary']
    etag = data.get('expense_tags', {})

    def a(k): return (s.get(k, {}) or {}).get('total', 0) or 0

    opening  = a('opening_balance')
    sales    = a('sale')
    ud_r     = a('udhaar_received')
    receipts = a('receipt')
    expenses = a('expense')
    bank     = a('bank_deposit')
    ud_g     = a('udhaar_given')
    cash     = a('cash_in_hand')
    upi      = a('upi_in_hand')

    lines = [f'📊 *{data["date"]} — {store_name}*']

    has_income = opening or sales or ud_r or receipts
    if has_income:
        lines.append('\n*📥 Income*')
        if opening:  lines.append(f'  🔓 Opening Balance:  ₹{opening:,.0f}')
        if sales:    lines.append(f'  💰 Sale:             ₹{sales:,.0f}')
        if receipts: lines.append(f'  📨 Receipts:         ₹{receipts:,.0f}')
        if ud_r:     lines.append(f'  📥 Credit Received:  ₹{ud_r:,.0f}')
        total_in = opening + sales + ud_r + receipts
        lines.append(f'  {"─"*21}')
        lines.append(f'  *Total IN:           ₹{total_in:,.0f}*')

    if expenses > 0:
        lines.append('\n*📤 Expenses by Category*')
        for tag, amt in sorted(etag.items(), key=lambda x: -x[1]):
            lines.append(f'  {tag_emoji(tag)} {tag_label(tag)}: ₹{amt:,.0f}')
        lines.append(f'  {"─"*21}')
        lines.append(f'  *Total Expenses:     ₹{expenses:,.0f}*')

    has_closing = bank or ud_g or cash or upi
    if has_closing:
        lines.append('\n*🏦 Closing / Settled*')
        if bank:  lines.append(f'  🏦 Bank Deposit:     ₹{bank:,.0f}')
        if ud_g:  lines.append(f'  📤 Credit Given:     ₹{ud_g:,.0f}')
        if cash:  lines.append(f'  💵 Cash in Hand:     ₹{cash:,.0f}')
        if upi:   lines.append(f'  📱 UPI in Hand:      ₹{upi:,.0f}')

    # Cash reconciliation — only if both sides present
    if has_income and (cash or upi):
        total_in        = opening + sales + ud_r + receipts
        total_accounted = expenses + bank + ud_g + cash + upi
        diff            = round(total_in - total_accounted, 2)
        lines.append('\n*🔍 CASH CHECK*')
        lines.append(f'  Total IN:            ₹{total_in:,.0f}')
        lines.append(f'  Total Accounted:     ₹{total_accounted:,.0f}')
        if abs(diff) < 1:
            lines.append('  ✅ *Balanced! No gap.*')
        elif diff > 0:
            lines.append(f'  ⚠️ *₹{diff:,.0f} UNACCOUNTED*')
            lines.append('  → Where did the cash go? Please check.')
        else:
            lines.append(f'  ℹ️ ₹{abs(diff):,.0f} extra recorded than income.')
            lines.append('  → Some income entry might be missing.')
    elif not has_income and expenses > 0:
        lines.append('\n_(Expenses only. Add opening balance + income for a complete check.)_')

    result = '\n'.join(lines)
    return _translate(result, language)


def format_period_summary(data: dict, store_name: str = 'Store', language: str = 'hinglish') -> str:
    s    = data['summary']
    etag = data.get('expense_tags', {})

    def g(k): return s.get(k, 0) or 0

    sales    = g('sale')
    expenses = g('expense')
    bank     = g('bank_deposit')
    ud_g     = g('udhaar_given')
    ud_r     = g('udhaar_received')
    net      = sales - expenses

    lines = [
        f'{"📈" if net >= 0 else "📉"} *{data.get("label","")} — {store_name}*',
        f'_{data["start"]}  →  {data["end"]}_',
        '',
        '*📥 Income*',
        f'  💰 Total Sales:     ₹{sales:,.0f}',
    ]
    if ud_r: lines.append(f'  📥 Credit Received: ₹{ud_r:,.0f}')

    if expenses > 0:
        lines += ['', '*📤 Expenses by Category*']
        for tag, amt in sorted(etag.items(), key=lambda x: -x[1]):
            lines.append(f'  {tag_emoji(tag)} {tag_label(tag)}: ₹{amt:,.0f}')
        lines += [f'  {"─"*21}', f'  *Total: ₹{expenses:,.0f}*']

    if bank or ud_g:
        lines += ['', '*🏦 Other Outflows*']
        if bank:  lines.append(f'  🏦 Bank Deposits:    ₹{bank:,.0f}')
        if ud_g:  lines.append(f'  📤 Credit Given:     ₹{ud_g:,.0f}')

    lines += ['', '─' * 22,
              f'{"📈" if net >= 0 else "📉"} *Net (Sales − Expenses): ₹{net:,.0f}*']

    daily = data.get('daily_sales', [])
    if len(daily) > 1:
        best  = max(daily, key=lambda x: x['total'])
        worst = min(daily, key=lambda x: x['total'])
        lines += [f'\n📅 Best day:  {best["date"]}  ₹{best["total"]:,.0f}',
                  f'📅 Worst day: {worst["date"]}  ₹{worst["total"]:,.0f}']

    result = '\n'.join(lines)
    return _translate(result, language)


def format_udhaar_list(udhaar_list: list, language: str = 'hinglish') -> str:
    if not udhaar_list:
        return _translate('✅ No outstanding credit! All clear.', language)
    total = sum(u['balance'] for u in udhaar_list)
    lines = ['📋 *Outstanding Udhaar:*\n']
    for u in udhaar_list:
        lines.append(f'• {u["person_name"]}: ₹{u["balance"]:,.0f}')
    lines.append(f'\n💰 *Total: ₹{total:,.0f}*')
    return _translate('\n'.join(lines), language)
