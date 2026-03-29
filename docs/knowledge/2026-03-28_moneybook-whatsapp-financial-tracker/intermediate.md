# MoneyBook — Complete Technical Rebuild Guide

> Goal: After reading this, you can rebuild the entire system from scratch.

---

## 1. What We Built

A WhatsApp chatbot for Indian retail store owners to track daily finances from handwritten notebook photos. Built with:

- **FastAPI** — webhook server (Python)
- **Twilio** — WhatsApp messaging
- **Anthropic Claude API** — AI parsing (vision + text)
- **SQLite** — local database
- **APScheduler** — daily/weekly scheduled jobs
- **Cloudflared** — localhost tunnel for Twilio webhook

---

## 2. Directory Structure

```
/go/
├── .env                          ← API keys (never commit)
├── CLAUDE.md                     ← AI agent instructions
├── requirements_moneybook.txt    ← pip dependencies
├── .tmp/
│   └── moneybook.db              ← SQLite database (auto-created)
├── execution/
│   ├── moneybook_db.py           ← All database operations
│   ├── moneybook_parser.py       ← Claude AI parsing + formatters
│   └── moneybook_webhook.py      ← FastAPI server + conversation state
└── directives/
    └── moneybook.md              ← SOP and learnings
```

---

## 3. Environment Setup

### .env file
```
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
# DB_PATH=.tmp/moneybook.db     ← optional override
```

### Install dependencies
```bash
pip install fastapi uvicorn twilio anthropic apscheduler httpx python-dotenv
```

### Run the server
```bash
uvicorn execution.moneybook_webhook:app --host 0.0.0.0 --port 8000 --reload
```

### Expose to internet (for Twilio webhook)
```bash
cloudflared tunnel --url http://localhost:8000
# Copy the https://xxx.trycloudflare.com URL
# Set it in Twilio Console → Messaging → WhatsApp Sandbox → "When a message comes in"
# Append /whatsapp → https://xxx.trycloudflare.com/whatsapp  (HTTP POST)
```

### Verify server is running
```bash
curl http://localhost:8000/health
# → {"status":"ok","service":"MoneyBook v2","date":"2026-03-28"}
```

---

## 4. Critical: `load_dotenv` Path Fix

**Problem:** All three scripts (`moneybook_db.py`, `moneybook_parser.py`, `moneybook_webhook.py`) live in `execution/`. When uvicorn runs them, `os.getcwd()` is the project root `/go/` but `__file__` is `/go/execution/script.py`. Plain `load_dotenv()` searches from CWD and works sometimes but fails when scripts are imported as modules from a different context.

**Fix used in ALL three files:**
```python
from dotenv import load_dotenv
from pathlib import Path

# Always resolve relative to THIS file's location, not CWD
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env', override=True)
```

This goes at the top of each file before any `os.getenv()` calls.

---

## 5. Database: `moneybook_db.py`

### Schema (6 tables)

```sql
-- One row per store (identified by WhatsApp phone number)
CREATE TABLE stores (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT,
    phone            TEXT UNIQUE NOT NULL,
    language         TEXT DEFAULT 'auto',
    onboarding_state TEXT DEFAULT 'new',    -- new | awaiting_name | active
    bot_state        TEXT DEFAULT '{}',     -- JSON: current conversation state
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Every confirmed financial transaction
CREATE TABLE transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id        INTEGER NOT NULL,
    date            DATE NOT NULL,
    type            TEXT NOT NULL,          -- see transaction types below
    amount          REAL NOT NULL,
    description     TEXT,
    tag             TEXT,                   -- expense category tag
    person_name     TEXT,
    person_category TEXT,                   -- staff|customer|supplier|home|other
    payment_mode    TEXT,                   -- cash|upi|bank|credit|null
    raw_message     TEXT,
    source          TEXT DEFAULT 'text',    -- text|image
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id)
);

-- Running udhaar (credit) balance per person
CREATE TABLE udhaar (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id              INTEGER NOT NULL,
    person_name           TEXT NOT NULL,
    phone                 TEXT,
    balance               REAL DEFAULT 0,
    last_transaction_date DATE,
    UNIQUE (store_id, person_name COLLATE NOCASE)
);

-- Individual udhaar credit/debit events
CREATE TABLE udhaar_transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    udhaar_id      INTEGER NOT NULL,
    transaction_id INTEGER,
    amount         REAL NOT NULL,
    type           TEXT NOT NULL,   -- given | received
    date           DATE NOT NULL
);

-- Person registry: staff/customer/supplier/home
CREATE TABLE persons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id   INTEGER NOT NULL,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL,   -- staff|customer|supplier|home|other
    UNIQUE (store_id, name COLLATE NOCASE)
);

-- Correction log: owner's fixes, used as few-shot examples in future AI prompts
CREATE TABLE store_corrections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id       INTEGER NOT NULL,
    raw_text       TEXT,           -- what was in the original parse context
    original_json  TEXT,           -- AI's original transaction (JSON string)
    corrected_json TEXT NOT NULL,  -- owner's corrected version (JSON string)
    entry_index    INTEGER,        -- 1-based index of corrected entry
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Migration pattern (for adding columns to existing DBs)
```python
def _migrate(conn):
    _try_alter(conn, "ALTER TABLE stores ADD COLUMN bot_state TEXT DEFAULT '{}'")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN tag TEXT")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN person_category TEXT")

def _try_alter(conn, sql: str):
    try:
        conn.execute(sql)
    except Exception:
        pass  # Column already exists — safe to ignore
```

### Key function: `add_transaction` with deduplication
```python
def add_transaction(store_id, txn, raw_message=None, source='text') -> int:
    with get_db() as conn:
        # Prevent double-save: same store+date+type+amount within 10 minutes → skip
        recent_dup = conn.execute("""
            SELECT id FROM transactions
            WHERE store_id=? AND date=? AND type=? AND amount=?
              AND created_at >= datetime('now', '-10 minutes')
            LIMIT 1
        """, (store_id, txn_date, txn['type'], float(txn['amount']))).fetchone()
        if recent_dup:
            return recent_dup['id']   # idempotent return

        # Insert + auto-update udhaar balance if it's an udhaar transaction
        cursor = conn.execute("INSERT INTO transactions ...", (...))
        if txn['type'] in ('udhaar_given', 'udhaar_received') and txn.get('person_name'):
            _update_udhaar(conn, store_id, txn, cursor.lastrowid, txn_date)
    return cursor.lastrowid
```

### Key function: `get_daily_summary` with date fallback
```python
def get_daily_summary(store_id, for_date=None):
    if not for_date:
        for_date = date.today().isoformat()
    with get_db() as conn:
        # If today has no data, show most recent date that has data
        has_data = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE store_id=? AND date=?",
            (store_id, for_date)
        ).fetchone()[0]
        if not has_data:
            latest = conn.execute(
                "SELECT date FROM transactions WHERE store_id=? ORDER BY date DESC LIMIT 1",
                (store_id,)
            ).fetchone()
            if latest:
                for_date = latest[0]
        # ... rest of query
```

### Per-store learning: `build_store_context`
```python
def build_store_context(store_id: int) -> str:
    corrections = get_recent_corrections(store_id, limit=15)
    if not corrections:
        return ""
    lines = ["📚 Past corrections for this store (learn from these):"]
    for c in corrections:
        orig = json.loads(c['original_json'])
        corr = json.loads(c['corrected_json'])
        lines.append(f'  • "{orig["description"]}" → type:{corr["type"]}, tag:{corr["tag"]}')
    return '\n'.join(lines)
```
This output gets injected into every AI prompt as few-shot examples.

---

## 6. Parser: `moneybook_parser.py`

### Models
```python
_TEXT_MODEL   = 'claude-haiku-4-5'    # fast, cheap — for text messages
_VISION_MODEL = 'claude-sonnet-4-5'   # best vision — for notebook photos
```

### Tag taxonomy (15 tags)
```python
TAG_META = {
    'sale':             ('Bikri / Sale',        '💰'),
    'cash_discount':    ('Cash Discount',        '🏷️'),
    'electricity':      ('Bijli / Electricity',  '💡'),
    'transport':        ('Transport / Labour',   '🚚'),
    'dues':             ('Dues / Baki',          '📤'),
    'staff_salary':     ('Staff Salary',         '👷'),
    'office_supplies':  ('Office / Stationery',  '📎'),
    'cleaning':         ('Cleaning Supplies',    '🧹'),
    'bank':             ('Bank',                 '🏦'),
    'upi':              ('UPI',                  '📱'),
    'cash':             ('Cash',                 '💵'),
    'home_expense':     ('Ghar / Home',          '🏠'),
    'purchase':         ('Purchase / Kharidi',   '📦'),
    'opening':          ('Opening Balance',      '🔓'),
    'other':            ('Other',                '📝'),
}
```

### Transaction types
```
opening_balance   → day's starting cash
sale              → revenue from selling goods
receipt           → money received (not a sale: advance, return, person paid back)
expense           → any outgoing payment
udhaar_given      → credit given (they'll pay later)
udhaar_received   → repayment of credit
bank_deposit      → cash moved to bank account
cash_in_hand      → physical cash counted at day end
upi_in_hand       → UPI/digital total at day end
```

### The image parse prompt (key sections)

```python
_IMAGE_PARSE_PROMPT = """\
You are an expert at reading handwritten Indian retail store cash books.
TODAY: {today}
{store_context}

━━ HOW TO READ THE PAGE ━━
The page has TWO columns:
  LEFT  = Money IN  → opening balance, sales, received from people
  RIGHT = Money OUT → expenses, bank deposits, day-end cash count, UPI total

Read EVERY row in BOTH columns. Do not skip any entry, no matter how small.
Denomination breakdowns (500×69=34500, 200×21=4200...) → add as ONE cash_in_hand.

━━ MISSPELLINGS ━━
Finail/Fynail/Phenal → Phenyl → tag: cleaning
OPI/0PI/UPl         → UPI (U and O look alike in handwriting)
CD [name]           → Cash Discount → type: expense, tag: cash_discount

━━ INDIAN NUMBER FORMAT — CRITICAL ━━
1,12,923 = [1][12][923] = 112923  (NOT 11292 — never drop digits)
10,898   = [10][898]    = 10898

━━ OUTPUT — ONLY valid JSON ━━
{
  "date": "YYYY-MM-DD",
  "transactions": [{
    "type": "...", "amount": 0, "description": "...", "tag": "...",
    "person_name": null, "person_category": null,
    "payment_mode": null, "date": "YYYY-MM-DD"
  }],
  "persons_found": [],
  "response_message": "N entries found, total IN ₹X, total OUT ₹Y",
  "ocr_confidence": "high|medium|low",
  "skipped_entries": "anything unclear"
}
"""
```

### Single-pass vision (why it matters)
```python
def parse_image_message(image_url, twilio_account_sid, twilio_auth_token, store_context=''):
    # Download image from Twilio (must follow redirects — Twilio CDN issues 307)
    r = httpx.get(image_url, auth=(sid, token), timeout=40, follow_redirects=True)
    image_bytes = r.content
    image_mime  = r.headers.get('content-type', 'image/jpeg').split(';')[0]

    # Single pass: Sonnet reads image AND structures JSON in one call
    # (Two-pass was: Sonnet OCR text → Haiku structure JSON — lost spatial context)
    prompt = _IMAGE_PARSE_PROMPT.format(
        today=date.today().isoformat(),
        store_context=store_context or '(No prior corrections)',
    )
    result_text = _call_claude(
        _VISION_MODEL, prompt,
        image_bytes=image_bytes, image_mime=image_mime
    )
    result = _safe_parse(result_text, "Photo padh nahi paya 📷")
    result['raw_ocr'] = '[single-pass — no separate OCR step]'
    return result
```

### Claude API call with retry
```python
def _call_claude(model, prompt, image_bytes=None, image_mime=None, retries=3):
    content = (
        [{'type': 'image', 'source': {'type': 'base64',
           'media_type': image_mime, 'data': base64.b64encode(image_bytes).decode()}},
         {'type': 'text', 'text': prompt}]
        if image_bytes else prompt
    )
    for attempt in range(retries):
        try:
            resp = _client.messages.create(
                model=model, max_tokens=4096,
                messages=[{'role': 'user', 'content': content}]
            )
            return resp.content[0].text
        except anthropic.RateLimitError:
            if attempt < retries - 1:
                time.sleep(15 * (2 ** attempt))   # 15s, 30s, 60s
            else:
                raise
```

---

## 7. Webhook: `moneybook_webhook.py`

### The 15-second problem and fix

Twilio disconnects if your webhook doesn't respond within 15 seconds. Claude vision takes 20-40 seconds. Solution: return instantly, process in background, push result via REST API.

```python
@app.post('/whatsapp')
async def whatsapp_webhook(background_tasks: BackgroundTasks, ...):
    if has_media:
        # Add to background — this returns immediately
        background_tasks.add_task(
            process_image_and_reply, from_number, MediaUrl0, body
        )
        # This response goes back to Twilio in <1 second
        return twiml_reply("📷 Photo mil gayi! Padh raha hoon... ⏳")

def process_image_and_reply(from_number, media_url, body):
    # This runs AFTER the webhook has already returned
    # No 15-second constraint here
    parsed = parse_image_message(media_url, SID, TOKEN, ctx)
    # ...
    # Push result via Twilio REST API (not via TwiML response)
    twilio.messages.create(from_=TWILIO_NUMBER, to=from_number, body=reply)
```

### Conversation state machine

States are stored as JSON in `stores.bot_state` column — survives restarts.

```
new → [first message] → awaiting_name → [store name given] → active

active/idle → [image sent]              → background_task → confirming
active/idle → [text transaction]        → confirming (if multiple) or auto-save (if single)
active/idle → [/summary or /month etc.] → instant reply

confirming  → [haan / yes / ok]         → save all → classifying (if new persons) or idle
confirming  → [galat N]                 → correcting
confirming  → [N tag electricity]       → update tag inline → back to confirming
confirming  → [cancel]                  → idle

correcting  → [correction text]         → save correction for learning → back to confirming

classifying → [1/2/3/4]                → save person category → next person or idle
```

State object structure:
```json
{
  "state": "confirming",
  "pending": [{"type":"expense","amount":60,"description":"Phenyl",...}],
  "persons_found": ["Rohit", "Vivek Singh"],
  "persons_map": {},
  "raw_message": "",
  "source": "image",
  "page_date": "2026-03-27",
  "raw_ocr": "[single-pass]"
}
```

### Commands supported
```python
COMMANDS = {
    '/summary': 'summary', 'aaj ka hisaab': 'summary',
    '/month':   'month',   'is mahine': 'month',
    '/quarter': 'quarter', 'is quarter': 'quarter',
    '/year':    'year',    'is saal': 'year',
    '/udhaar':  'udhaar',  'udhaar list': 'udhaar',
    '/help':    'help',
}
```

Period date ranges computed in `run_command()`:
- `/month` → `today.replace(day=1)` → `today`
- `/quarter` → `q_start_month = ((today.month-1)//3)*3+1` → `today`
- `/year` → `today.replace(month=1, day=1)` → `today`

### Scheduled jobs (APScheduler)
```python
_scheduler = BackgroundScheduler(timezone='Asia/Kolkata')
_scheduler.add_job(job_daily_summary, 'cron', hour=21, minute=0)   # 9 PM daily
_scheduler.add_job(job_udhaar_alerts, 'cron', day_of_week='mon', hour=9)  # Monday 9AM

@app.on_event('startup')
def on_startup():
    init_db()
    _scheduler.start()
```

`job_udhaar_alerts` queries `get_udhaar_aging(store_id, days=30)` — persons with outstanding balance whose `last_transaction_date` is ≥30 days ago.

---

## 8. All Bugs Fixed (with exact fixes)

| # | Bug | Symptom | Root Cause | Exact Fix |
|---|-----|---------|-----------|-----------|
| 1 | `load_dotenv` not working | `ANTHROPIC_API_KEY` is None | Script in subdirectory; `load_dotenv()` searches CWD | `load_dotenv(Path(__file__).resolve().parent.parent / '.env', override=True)` |
| 2 | Twilio image redirect | `Redirect response '307 Temporary Redirect'` | Twilio CDN redirects media URLs | `httpx.get(..., follow_redirects=True)` |
| 3 | No reply to photo | Webhook times out silently | Claude vision takes 20-40s; Twilio kills at 15s | `BackgroundTasks` + instant ack + REST API reply |
| 4 | Gemini 429 quota | `You exceeded your current quota` | Free tier: 20 req/day on gemini-2.5-flash | Rewrote entire parser to use Anthropic Claude API |
| 5 | Deprecated model names | `model not found` | Claude renamed `claude-3-5-haiku-20241022` | Changed to `claude-haiku-4-5` and `claude-sonnet-4-5` |
| 6 | `/summary` shows only header | Empty summary body | `get_daily_summary` queried today; data was yesterday | Fallback: if today has no data, use most recent date with data |
| 7 | Duplicate transactions | Same entry saved twice | Owner confirms twice (misclick) | 10-minute dedup window in `add_transaction` |
| 8 | Missing entries in photo parse | "60 - Phenyl" not found | Two-pass OCR loses spatial/column context | Single-pass: Sonnet reads image + structures JSON in one call |
| 9 | Sale: `11,292` instead of `1,12,923` | Wrong amount saved | Indian number format: `1,12,923` misread | Explicit format rule in prompt: `[1][12][923]` = 112923 |
| 10 | `OPI` instead of `UPI` | Payment mode wrong | U/O look alike in handwriting | Misspelling dict in prompt: `OPI/0PI/UPl → UPI` |
| 11 | `gemini-2.5-flash-preview-05-20 not found` | KB/doc scripts fail | Model renamed | Changed to `gemini-2.5-flash`; then 429 → migrated to Claude API |
| 12 | Opening/cash entries show `📝 Other` | Wrong emoji/label | Non-expense types have no expense tag | `_TYPE_META` dict in `format_pending_confirmation`: map type → emoji directly |

---

## 9. Summary Formatter Logic

### Daily summary: cash reconciliation
```python
def format_daily_summary(data, store_name):
    total_in        = opening + sales + udhaar_received + receipts
    total_accounted = expenses + bank_deposit + udhaar_given + cash_in_hand + upi_in_hand
    diff            = round(total_in - total_accounted, 2)

    if abs(diff) < 1:
        "✅ Balanced!"
    elif diff > 0:
        f"⚠️ ₹{diff} UNACCOUNTED → Cash gaya kahan?"
    else:
        f"ℹ️ ₹{abs(diff)} extra recorded than income"
```

Expense section shows category breakdown (not just total):
```
📤 GAYA — Kharcha by Category
  🧹 Cleaning: ₹60
  🏷️ Cash Discount: ₹395
  Total: ₹455
```

---

## 10. Running End-to-End

```bash
# Terminal 1: Start server
cd /go
uvicorn execution.moneybook_webhook:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Start tunnel
cloudflared tunnel --url http://localhost:8000
# → Copy URL: https://xyz.trycloudflare.com

# Twilio Console: Set webhook
# Messaging → Try it out → Send a WhatsApp message
# "When a message comes in": https://xyz.trycloudflare.com/whatsapp  [HTTP POST]

# WhatsApp: Join sandbox
# Send "join <sandbox-word>" to +14155238886 (or your sandbox number)
# Then start chatting
```

⚠️ **Cloudflared URL changes every restart.** Must update Twilio webhook URL each time. For production: deploy to Railway/Render for a fixed URL.
