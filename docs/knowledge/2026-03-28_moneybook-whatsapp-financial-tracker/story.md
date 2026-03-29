# The Complete Story of MoneyBook
### A WhatsApp Financial Tracker Built for Indian Retail Stores

> Written for a software engineer. Every file, every function, every API call, every bug, every fix — in narrative form. Long by design.

---

## Part 1: The Problem

Small and mid-size Indian retail store owners — kirana shops, wholesale distributors, general stores — track their daily finances in handwritten notebooks called *bahi khata* or *rozkaamil*. These are physical two-column ledgers:

- **Left column = Money IN**: opening balance, sales, money received from people
- **Right column = Money OUT**: expenses, bank deposits, day-end cash count, UPI total

Entries are in mixed Hindi/Gujarati/English with abbreviations (`CD` = Cash Discount, `Jama` = deposit), misspellings (`Finail` = Phenyl, `OPI` = UPI), and shorthand only the owner understands (`A. Tini` = A. Tiwari).

The problem: the notebook can't answer questions. No summaries. No cash reconciliation. No udhaar (credit) tracking. No alerts for missing money. If ₹500 disappears over a week, nobody knows.

The target users are already on WhatsApp all day. The solution: a bot that lives in WhatsApp. Owner sends a notebook photo → bot reads everything → sends back a structured summary → owner confirms or corrects → data is saved and queryable forever.

---

## Part 2: Technology Choices

| Concern | Tool | Why chosen |
|---------|------|-----------|
| WhatsApp interface | Twilio sandbox | Fastest path to WhatsApp without Meta API approval. Sandbox number: `whatsapp:+14155238886` |
| HTTP server | FastAPI (Python) | Async-native, `BackgroundTasks` built-in (critical for Twilio timeout), minimal boilerplate |
| AI vision (photos) | Claude Sonnet (`claude-sonnet-4-5`) | Best handwriting recognition + multilingual (Hindi/Gujarati/English). One API, one key |
| AI text (messages) | Claude Haiku (`claude-haiku-4-5`) | 3x cheaper than Sonnet for simple text parsing where vision isn't needed |
| Database | SQLite | Zero-ops, file-based, no server process. Schema is multi-tenant (all tables have `store_id`) |
| Scheduled jobs | APScheduler | In-process cron, no Redis/Celery needed. Daily 9PM summaries + Monday udhaar alerts |
| localhost → internet | Cloudflared | Free ephemeral tunnel. Twilio needs a public HTTPS URL to hit your webhook |

**Original plan:** Gemini API for vision. **Actual:** Gemini free tier hit quota mid-session (429 error). Switched everything to Anthropic Claude API. Same `.env` file already had the key.

---

## Part 3: Project Layout

```
/go/
├── .env                           ← All secrets (never commit)
│   ├── ANTHROPIC_API_KEY
│   ├── TWILIO_ACCOUNT_SID
│   ├── TWILIO_AUTH_TOKEN
│   └── TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
│
├── CLAUDE.md                      ← AI agent instructions (3-layer architecture SOP)
├── requirements_moneybook.txt
│
├── execution/                     ← Layer 3: Deterministic Python
│   ├── moneybook_db.py            ← Database: SQLite, all read/write operations
│   ├── moneybook_parser.py        ← AI: Claude API calls, prompts, formatters
│   └── moneybook_webhook.py       ← Server: FastAPI, Twilio handler, state machine
│
├── directives/
│   └── moneybook.md               ← SOP: how to run, known bugs, learnings
│
└── .tmp/
    └── moneybook.db               ← SQLite file (auto-created on first run)
```

Three execution files. Each has a single responsibility. They import from each other in one direction: `webhook.py` imports from both `db.py` and `parser.py`. `parser.py` and `db.py` are independent of each other.

---

## Part 4: The Database Layer (`moneybook_db.py`)

### 4.1 The `load_dotenv` Fix — First Bug, Everywhere

Every file starts with this exact pattern:
```python
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env', override=True)
```

Why not plain `load_dotenv()`? When uvicorn imports `execution.moneybook_db`, the working directory is `/go/`. But `__file__` resolves to `/go/execution/moneybook_db.py`. Plain `load_dotenv()` searches from wherever the process was started — sometimes that's the project root, sometimes it isn't. Using `Path(__file__).resolve().parent.parent` always gives `/go/` regardless of how the script is invoked. `override=True` ensures `.env` values take precedence over any shell environment variables.

This pattern is repeated identically in all three files.

### 4.2 Database Path

```python
_BASE   = os.path.join(os.path.dirname(__file__), '..', '.tmp')
DB_PATH = os.getenv('DB_PATH', os.path.join(_BASE, 'moneybook.db'))
```

Default path: `/go/.tmp/moneybook.db`. Can be overridden via `DB_PATH` env var. The `.tmp/` directory is auto-created by `init_db()` if it doesn't exist.

### 4.3 Connection Context Manager

```python
@contextmanager
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row      # rows behave like dicts: row['column_name']
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

Every database operation uses `with get_db() as conn:`. Auto-commit on success, auto-rollback on exception, always closes. `row_factory = sqlite3.Row` means every query result can be accessed by column name (`row['store_id']`) and converted to dict with `dict(row)`.

### 4.4 Schema: 6 Tables

**`stores`** — one row per WhatsApp number:
```sql
CREATE TABLE IF NOT EXISTS stores (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT,
    phone            TEXT UNIQUE NOT NULL,   -- WhatsApp number e.g. "whatsapp:+919876543210"
    language         TEXT DEFAULT 'auto',
    onboarding_state TEXT DEFAULT 'new',     -- new | awaiting_name | active
    bot_state        TEXT DEFAULT '{}',      -- JSON blob: current conversation state
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

The `bot_state` column is a JSON string. The entire conversation state machine lives here. No separate sessions table. This means bot state survives server restarts — a huge reliability win.

**`transactions`** — every confirmed financial entry:
```sql
CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id        INTEGER NOT NULL,
    date            DATE NOT NULL,
    type            TEXT NOT NULL,       -- opening_balance|sale|receipt|expense|udhaar_given|
                                         -- udhaar_received|bank_deposit|cash_in_hand|upi_in_hand
    amount          REAL NOT NULL,
    description     TEXT,
    tag             TEXT,                -- expense category: cleaning|electricity|transport|etc.
    person_name     TEXT,
    person_category TEXT,                -- staff|customer|supplier|home|other
    payment_mode    TEXT,                -- cash|upi|bank|credit|null
    raw_message     TEXT,                -- original text or image URL (for audit)
    source          TEXT DEFAULT 'text', -- text|image
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id)
);
```

**`udhaar`** — running credit balance per person:
```sql
CREATE TABLE IF NOT EXISTS udhaar (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id              INTEGER NOT NULL,
    person_name           TEXT NOT NULL,
    phone                 TEXT,
    balance               REAL DEFAULT 0,         -- positive = they owe Ramesh money
    last_transaction_date DATE,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id),
    UNIQUE (store_id, person_name COLLATE NOCASE)  -- case-insensitive uniqueness
);
```

**`udhaar_transactions`** — individual debit/credit events that feed into `udhaar.balance`:
```sql
CREATE TABLE IF NOT EXISTS udhaar_transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    udhaar_id      INTEGER NOT NULL,
    transaction_id INTEGER,    -- FK back to transactions table (for audit trail)
    amount         REAL NOT NULL,
    type           TEXT NOT NULL,   -- given | received
    date           DATE NOT NULL,
    notes          TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (udhaar_id)      REFERENCES udhaar (id),
    FOREIGN KEY (transaction_id) REFERENCES transactions (id)
);
```

**`persons`** — classification registry (so the bot remembers who each person is):
```sql
CREATE TABLE IF NOT EXISTS persons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id   INTEGER NOT NULL,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL,   -- staff|customer|supplier|home|other
    notes      TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id),
    UNIQUE (store_id, name COLLATE NOCASE)
);
```

**`store_corrections`** — the per-store AI learning log:
```sql
CREATE TABLE IF NOT EXISTS store_corrections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id       INTEGER NOT NULL,
    raw_text       TEXT,           -- context from the parse (OCR or original message)
    original_json  TEXT,           -- what the AI originally parsed (JSON string)
    corrected_json TEXT NOT NULL,  -- what the owner said it actually is (JSON string)
    entry_index    INTEGER,        -- 1-based: which entry number was corrected
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id)
);
```

Every time an owner says "galat 3" and provides the correction, a row is inserted here. These rows are later read and injected into the AI prompt as few-shot examples.

### 4.5 Migration Pattern

SQLite doesn't support `ALTER TABLE DROP COLUMN` well and `ADD COLUMN` fails if the column already exists. New columns are added safely with:

```python
def _migrate(conn):
    _try_alter(conn, "ALTER TABLE stores ADD COLUMN bot_state TEXT DEFAULT '{}'")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN tag TEXT")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN person_category TEXT")

def _try_alter(conn, sql: str):
    try:
        conn.execute(sql)
    except Exception:
        pass   # Column already exists — silently skip
```

`_migrate()` is called inside `init_db()` every startup. It's idempotent — safe to run on a fresh DB or an existing one.

### 4.6 Store Operations

`get_or_create_store(phone: str) -> dict` — upsert pattern using SELECT then INSERT:
```python
row = conn.execute("SELECT * FROM stores WHERE phone = ?", (phone,)).fetchone()
if not row:
    conn.execute("INSERT INTO stores (phone, ...) VALUES (?, ...)", (phone,))
    row = conn.execute("SELECT * FROM stores WHERE phone = ?", (phone,)).fetchone()
return dict(row)
```
Called on every incoming Twilio message. `phone` is the full WhatsApp number like `"whatsapp:+919876543210"`.

`update_store(store_id, **kwargs)` — dynamic UPDATE:
```python
cols = ', '.join(f"{k} = ?" for k in kwargs)
conn.execute(f"UPDATE stores SET {cols} WHERE id = ?", list(kwargs.values()) + [store_id])
```
Used to set `onboarding_state`, `name`, `bot_state`.

### 4.7 Bot State Operations

The entire conversation state machine persists in `stores.bot_state` (a JSON string). Three functions manage it:

```python
def get_bot_state(store_id: int) -> dict:
    row = conn.execute("SELECT bot_state FROM stores WHERE id = ?", (store_id,)).fetchone()
    return json.loads(row['bot_state'] or '{}')

def set_bot_state(store_id: int, state: dict):
    update_store(store_id, bot_state=json.dumps(state, ensure_ascii=False))

def clear_bot_state(store_id: int):
    update_store(store_id, bot_state='{}')
```

`ensure_ascii=False` preserves Hindi/Gujarati characters in the JSON string.

### 4.8 `add_transaction` — The Most Important DB Function

```python
def add_transaction(store_id: int, txn: dict, raw_message: str = None, source: str = 'text') -> int:
    txn_date = txn.get('date') or date.today().isoformat()

    # Auto-enrich: if person_name is known, pull their category from persons table
    person_cat = txn.get('person_category')
    if not person_cat and txn.get('person_name'):
        known = get_person(store_id, txn['person_name'])
        if known:
            person_cat = known['category']

    with get_db() as conn:
        # DEDUPLICATION: same (store, date, type, amount) within 10 minutes → skip
        recent_dup = conn.execute("""
            SELECT id FROM transactions
            WHERE store_id = ? AND date = ? AND type = ? AND amount = ?
              AND created_at >= datetime('now', '-10 minutes')
            LIMIT 1
        """, (store_id, txn_date, txn['type'], float(txn['amount']))).fetchone()
        if recent_dup:
            return recent_dup['id']   # idempotent return — no insert

        cursor = conn.execute("""
            INSERT INTO transactions
                (store_id, date, type, amount, description, tag,
                 person_name, person_category, payment_mode, raw_message, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (store_id, txn_date, txn['type'], float(txn['amount']),
              txn.get('description'), txn.get('tag'),
              txn.get('person_name'), person_cat,
              txn.get('payment_mode'), raw_message, source))
        txn_id = cursor.lastrowid

        # Auto-update udhaar balance for credit transactions
        if txn['type'] in ('udhaar_given', 'udhaar_received') and txn.get('person_name'):
            _update_udhaar(conn, store_id, txn, txn_id, txn_date)

    return txn_id
```

The deduplication check was added to fix Bug #7 (double confirmation). The dedup key is `(store_id, date, type, amount)` — not description or person name, because those may vary slightly between parses of the same entry. The 10-minute window is generous enough for any reasonable UX flow.

### 4.9 Udhaar Auto-Update

When a transaction of type `udhaar_given` or `udhaar_received` is saved, the udhaar balance is automatically maintained:

```python
def _update_udhaar(conn, store_id, txn, txn_id, txn_date):
    person = txn['person_name']
    amount = float(txn['amount'])

    # Get or create the udhaar record for this person
    row = conn.execute(
        "SELECT * FROM udhaar WHERE store_id=? AND person_name=? COLLATE NOCASE",
        (store_id, person)
    ).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO udhaar (store_id, person_name, balance, last_transaction_date) "
            "VALUES (?, ?, 0, ?)", (store_id, person, txn_date)
        )
        # Re-fetch to get the new ID
        row = conn.execute(...).fetchone()

    uid   = row['id']
    delta = amount if txn['type'] == 'udhaar_given' else -amount  # given = positive, received = negative
    ut    = 'given' if txn['type'] == 'udhaar_given' else 'received'

    conn.execute(
        "UPDATE udhaar SET balance = balance + ?, last_transaction_date = ? WHERE id = ?",
        (delta, txn_date, uid)
    )
    conn.execute(
        "INSERT INTO udhaar_transactions (udhaar_id, transaction_id, amount, type, date) "
        "VALUES (?, ?, ?, ?, ?)",
        (uid, txn_id, amount, ut, txn_date)
    )
```

`balance > 0` means the person owes money to the store. `balance < 0` would mean the store owes money to the person (advance paid).

### 4.10 `get_daily_summary` — With Date Fallback

```python
def get_daily_summary(store_id: int, for_date: str = None) -> dict:
    if not for_date:
        for_date = date.today().isoformat()

    with get_db() as conn:
        # BUG FIX: if today has no data, fall back to most recent date with data
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

        # Totals grouped by transaction type
        agg = conn.execute("""
            SELECT type, SUM(amount) AS total, COUNT(*) AS count
            FROM transactions WHERE store_id=? AND date=?
            GROUP BY type
        """, (store_id, for_date)).fetchall()

        # Expense breakdown by tag (for category-level detail)
        expense_tags = conn.execute("""
            SELECT COALESCE(tag, 'other') AS tag, SUM(amount) AS total
            FROM transactions
            WHERE store_id=? AND date=? AND type='expense'
            GROUP BY COALESCE(tag, 'other')
            ORDER BY total DESC
        """, (store_id, for_date)).fetchall()

        # Full transaction list for the day
        detail = conn.execute("""
            SELECT * FROM transactions WHERE store_id=? AND date=?
            ORDER BY created_at ASC
        """, (store_id, for_date)).fetchall()

    return {
        'date':         for_date,
        'summary':      {r['type']: {'total': r['total'], 'count': r['count']} for r in agg},
        'expense_tags': {r['tag']: r['total'] for r in expense_tags},
        'transactions': [dict(t) for t in detail],
    }
```

The date fallback is critical. Without it, `/summary` queried today's date (2026-03-28) but all test data was from yesterday (2026-03-27) — returning an empty summary with just the header line. The fallback makes `/summary` always show something useful.

### 4.11 `get_period_summary` — For Month/Quarter/Year

```python
def get_period_summary(store_id, start_date, end_date, label='') -> dict:
    with get_db() as conn:
        agg = conn.execute("""
            SELECT type, SUM(amount) AS total
            FROM transactions
            WHERE store_id=? AND date BETWEEN ? AND ?
            GROUP BY type
        """, (store_id, start_date, end_date)).fetchall()

        expense_tags = conn.execute("""
            SELECT COALESCE(tag, 'other') AS tag, SUM(amount) AS total
            FROM transactions
            WHERE store_id=? AND date BETWEEN ? AND ? AND type='expense'
            GROUP BY COALESCE(tag, 'other')
            ORDER BY total DESC
        """, (store_id, start_date, end_date)).fetchall()

        # Daily sales trend (best/worst day calculation)
        daily = conn.execute("""
            SELECT date, SUM(amount) AS total
            FROM transactions
            WHERE store_id=? AND date BETWEEN ? AND ? AND type='sale'
            GROUP BY date ORDER BY date ASC
        """, (store_id, start_date, end_date)).fetchall()

    return {'label': label, 'start': start_date, 'end': end_date,
            'summary': {r['type']: r['total'] for r in agg},
            'expense_tags': {r['tag']: r['total'] for r in expense_tags},
            'daily_sales': [dict(r) for r in daily]}
```

### 4.12 Correction Learning Functions

```python
def save_correction(store_id, raw_text, original_json, corrected_json, entry_index=None):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO store_corrections
                (store_id, raw_text, original_json, corrected_json, entry_index)
            VALUES (?, ?, ?, ?, ?)
        """, (store_id, raw_text,
              json.dumps(original_json, ensure_ascii=False),
              json.dumps(corrected_json, ensure_ascii=False),
              entry_index))

def get_recent_corrections(store_id, limit=15) -> list:
    with get_db() as conn:
        rows = conn.execute("""
            SELECT raw_text, original_json, corrected_json, created_at
            FROM store_corrections WHERE store_id=?
            ORDER BY created_at DESC LIMIT ?
        """, (store_id, limit)).fetchall()
        return [dict(r) for r in rows]

def build_store_context(store_id: int) -> str:
    corrections = get_recent_corrections(store_id, limit=15)
    if not corrections:
        return ""
    lines = ["📚 Past corrections for this store (learn from these):"]
    for c in corrections:
        orig = json.loads(c['original_json'])
        corr = json.loads(c['corrected_json'])
        orig_desc = orig.get('description', '?')
        lines.append(
            f'  • "{orig_desc}" → type:{corr.get("type","")}, tag:{corr.get("tag","")}'
            + (f', desc:"{corr.get("description","")}"' if corr.get('description') else '')
        )
    return '\n'.join(lines)
```

`build_store_context()` returns a multi-line string. This string is injected verbatim into every AI prompt via the `{store_context}` placeholder. The model receives it as: "These are things this specific store's owner has corrected before — apply these learnings."

---

## Part 5: The Parser Layer (`moneybook_parser.py`)

### 5.1 Claude Client Setup

```python
import anthropic

_api_key = os.getenv('ANTHROPIC_API_KEY')
_client  = anthropic.Anthropic(api_key=_api_key)

_TEXT_MODEL   = 'claude-haiku-4-5'    # for text message parsing
_VISION_MODEL = 'claude-sonnet-4-5'   # for image parsing
```

The Anthropic SDK is synchronous (not async). This is fine because image parsing runs in FastAPI's BackgroundTasks thread pool, not in the async event loop.

### 5.2 Tag Taxonomy

15 tags, each with a display label and emoji:
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

Helper functions `tag_label(tag)` and `tag_emoji(tag)` look up from this dict with `other` as fallback.

### 5.3 The Image Parse Prompt (`_IMAGE_PARSE_PROMPT`)

This is the most important piece of the entire system. The full prompt:

```
You are an expert at reading handwritten Indian retail store cash books (bahi khata / rozkaamil).
You will look at this image and extract every financial entry directly into structured JSON.

TODAY: {today}
{store_context}

━━ HOW TO READ THE PAGE ━━
The page has TWO columns:
  LEFT  = Money IN  → opening balance, sales, money received from people
  RIGHT = Money OUT → expenses, bank deposits, day-end cash count, UPI total

Read EVERY row in BOTH columns. Do not skip any entry, no matter how small (₹5, ₹60, ₹30).
Totals rows (marked TOTAL) → skip these, they are sums.
Denomination breakdowns (500×69=34500, 200×21=4200...) → add them all up as ONE cash_in_hand entry.

━━ TRANSACTION TYPES ━━
opening_balance  → starting cash for the day
sale             → revenue from selling goods (bikri / sale)
receipt          → money received that is NOT a sale (advance, return, received from someone)
expense          → any outgoing payment (bills, CD, dues, purchases, salary)
udhaar_given     → credit given to a customer (they will pay later)
udhaar_received  → repayment received from a credit customer
bank_deposit     → money deposited in bank
cash_in_hand     → physical cash at day end (denomination breakdown sums here)
upi_in_hand      → UPI/digital total at day end

━━ ABBREVIATIONS ━━
CD [name]   → Cash Discount → type: expense, tag: cash_discount
C.D [name]  → same as CD
UPI         → type: upi_in_hand
Cash / नकद → type: cash_in_hand
Jama / जमा → bank_deposit
Dues        → expense, tag: dues
Recvd / Received [name] → receipt, person_name = that name

━━ MISSPELLINGS — recognise these (very common in Indian store books) ━━
Finail / Fynail / Phenal / Final → Phenyl (cleaning liquid) → tag: cleaning
OPI / 0PI / UPl → UPI (handwriting: U and O look alike, l and I look alike)
Recived / Recieved → Received
Bijlee / Light bill → Electricity → tag: electricity
Transprt / Dhulai → Transport → tag: transport
Deposite → bank_deposit
Sallary / Mazdoori → staff_salary

━━ EXPENSE TAGS — MANDATORY, never null ━━
cash_discount, electricity, transport, dues, staff_salary,
office_supplies, cleaning, bank, home_expense, purchase, other

━━ INDIAN NUMBER FORMAT — CRITICAL ━━
Indian cashbooks use Indian comma format:
  1,12,923 = parts [1][12][923] → concatenate → 112923  (6 digits)
  10,898   = parts [10][898]    → concatenate → 10898   (5 digits)
  42,129   = parts [42][129]    → concatenate → 42129   (5 digits)
NEVER drop digits. Count every digit character between commas.

━━ ACCURACY RULES ━━
1. Read numbers digit by digit — do NOT round or approximate
2. Read names carefully — "Rohit" not "ROHT", "Vivek Singh" not "Vivek Sin"
3. Every amount on the page = one transaction. Zero exceptions.
4. If a label is unclear, make your best guess + use tag "other" — but INCLUDE the amount
5. For UPI total: even if it looks like "OPI" in handwriting → it is UPI

━━ OUTPUT — ONLY valid JSON, no markdown ━━
{
  "date": "<YYYY-MM-DD from page header, else {today}>",
  "transactions": [
    {
      "type": "<type>",
      "amount": <integer or decimal — NO commas>,
      "description": "<clear English description>",
      "tag": "<tag — REQUIRED>",
      "person_name": "<full name if mentioned, else null>",
      "person_category": null,
      "payment_mode": "<cash|upi|bank|credit|null>",
      "date": "<YYYY-MM-DD>"
    }
  ],
  "persons_found": ["Full Name 1", "Full Name 2"],
  "response_message": "<summary: N entries found, total IN ₹X, total OUT ₹Y>",
  "ocr_confidence": "<high|medium|low>",
  "skipped_entries": "<anything unclear>"
}
```

The `{today}` and `{store_context}` are Python `.format()` placeholders, filled at call time.

### 5.4 The Text Parse Prompt (`_TEXT_PROMPT`)

For text messages like "Sale 5000 cash" or "Raju ne 500 udhaar liya":
```
You are a financial transaction parser for Indian retail store owners.
Parse the message below and extract ALL financial transactions.

TODAY: {today}
MESSAGE: "{message}"

{store_context}

━━ IMPORTANT: CD = CASH DISCOUNT (not cash drawn) ━━
"CD A. Tiwari 695" → expense, tag: cash_discount, person: A. Tiwari, amount: 695

━━ OUTPUT — ONLY valid JSON ━━
{
  "transactions": [...],
  "persons_found": ["Name1"],
  "detected_language": "<hindi|gujarati|english|mixed>",
  "response_message": "<confirmation in SAME language as input>"
}
```

### 5.5 The Correction Prompt (`_CORRECTION_PROMPT`)

When owner says "galat 3" and provides a fix:
```
A store owner is correcting a single transaction entry that was wrongly parsed.

ORIGINAL ENTRY (what AI parsed):
{original}

OWNER'S CORRECTION: "{correction}"

Return ONLY the corrected transaction as JSON — same structure, only fix what changed.
```

The `parse_correction()` function merges original and corrected using Python dict unpacking:
```python
corrected = json.loads(_clean_json(text))
return {**original_txn, **corrected}   # override only the changed fields
```

### 5.6 The `_call_claude` Function

```python
def _call_claude(model: str, prompt: str,
                 image_bytes: bytes = None, image_mime: str = None,
                 retries: int = 3) -> str:

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
        content = prompt   # plain string for text-only calls

    for attempt in range(retries):
        try:
            resp = _client.messages.create(
                model=model,
                max_tokens=4096,
                messages=[{'role': 'user', 'content': content}],
            )
            return resp.content[0].text
        except anthropic.RateLimitError:
            if attempt < retries - 1:
                wait = 15 * (2 ** attempt)   # 15s, 30s, 60s exponential backoff
                time.sleep(wait)
            else:
                raise
        except anthropic.APIError as e:
            if '529' in str(e) or 'overloaded' in str(e).lower():
                if attempt < retries - 1:
                    time.sleep(10 * (2 ** attempt))
                    continue
            raise
```

For image calls, the Anthropic API expects a list of content blocks: first the image block (base64-encoded), then the text prompt block. The model sees both simultaneously.

### 5.7 `parse_image_message` — Single-Pass Vision

This function went through the most significant architectural change of the entire project:

**Original (two-pass, broken):**
```python
# Pass 1: OCR — Sonnet reads image, returns raw text
raw_text = _call_claude(VISION_MODEL, _OCR_PROMPT, image_bytes=img, image_mime=mime)

# Pass 2: Structure — Haiku receives text, returns JSON
struct_prompt = _STRUCTURE_PROMPT.format(raw_text=raw_text, today=today, ...)
struct_text = _call_claude(TEXT_MODEL, struct_prompt)   # TEXT_MODEL = Haiku, no image
```

**Why it failed:** "60 - Finail" was written at the top of the right column, near the column divider. The column position is a 2D spatial property. When Sonnet extracted it into linear OCR text, that position was lost. Haiku received a flat list of text strings with no way to infer "this was on the right side = expense." It either skipped the entry or misclassified it.

**Fix (single-pass):**
```python
def parse_image_message(image_url, twilio_account_sid, twilio_auth_token, store_context=''):
    # Step 1: Download image from Twilio
    auth = (twilio_account_sid, twilio_auth_token) if twilio_account_sid else None
    r = httpx.get(image_url, auth=auth, timeout=40, follow_redirects=True)
    # follow_redirects=True is CRITICAL — Twilio CDN issues 307 redirect to actual storage URL
    r.raise_for_status()
    image_bytes = r.content
    image_mime  = r.headers.get('content-type', 'image/jpeg').split(';')[0]

    # Step 2: Single-pass — Sonnet reads image AND structures JSON in one call
    prompt = _IMAGE_PARSE_PROMPT.format(
        today=date.today().isoformat(),
        store_context=store_context or '(No prior corrections for this store yet)',
    )
    result_text = _call_claude(
        _VISION_MODEL, prompt,
        image_bytes=image_bytes, image_mime=image_mime
    )

    result = _safe_parse(result_text, "Photo padh nahi paya 📷\nClear photo bhejiye.")
    result['raw_ocr'] = '[single-pass — no separate OCR step]'
    return result
```

Now Sonnet sees the raw image pixels AND the structured output instructions simultaneously. It reads both columns, maintains spatial relationships, and produces JSON in one cognitive step — the same way a human reads a page.

### 5.8 JSON Parsing Safety

```python
def _clean_json(raw: str) -> str:
    raw = raw.strip()
    raw = re.sub(r'^```[a-z]*\n?', '', raw)   # strip ```json fences
    raw = re.sub(r'\n?```$', '', raw)
    return raw.strip()

def _safe_parse(raw: str, fallback_msg: str) -> dict:
    try:
        return json.loads(_clean_json(raw))
    except json.JSONDecodeError:
        return {'transactions': [], 'persons_found': [], 'response_message': fallback_msg}
```

Despite the prompt saying "ONLY valid JSON, no markdown," Claude sometimes wraps output in ```json fences. `_clean_json` strips them before parsing.

### 5.9 The Confirmation Formatter

```python
def format_pending_confirmation(transactions: list, page_date: str = None) -> str:
    header = '📋 *Maine padha' + (f' ({page_date})' if page_date else '') + ':*\n'
    lines  = [header]

    # Type-to-display mapping for non-expense transaction types
    _TYPE_META = {
        'opening_balance': ('🔓', 'Opening Balance'),
        'sale':            ('💰', 'Bikri / Sale'),
        'receipt':         ('📨', 'Receipt'),
        'udhaar_given':    ('📤', 'Udhaar Diya'),
        'udhaar_received': ('📥', 'Udhaar Mila'),
        'bank_deposit':    ('🏦', 'Bank Deposit'),
        'cash_in_hand':    ('💵', 'Cash in Hand'),
        'upi_in_hand':     ('📱', 'UPI in Hand'),
    }

    for i, t in enumerate(transactions, 1):
        tag      = t.get('tag') or 'other'
        txn_type = t.get('type', '')
        # Non-expense types don't have meaningful expense tags → use type-based display
        if tag == 'other' and txn_type in _TYPE_META:
            emoji, label = _TYPE_META[txn_type]
        else:
            emoji = tag_emoji(tag)
            label = tag_label(tag)
        name = f': {t["person_name"]}' if t.get('person_name') else ''
        desc = t.get('description', '').strip()
        lines.append(
            f'{i}. {desc}{name} — ₹{float(t["amount"]):,.0f}\n'
            f'   {emoji} _{label}_'
        )

    lines.append(
        '\n✅ *haan* → Sab save karo\n'
        '✏️ *galat 3* → Entry 3 theek karo\n'
        '❌ *cancel* → Cancel'
    )
    return '\n'.join(lines)
```

The `_TYPE_META` dict was added after Bug #12: opening balance, cash in hand, and UPI were all showing `📝 Other` because they're not "expense" types and don't have an expense tag — but the formatter was only looking up `TAG_META` (which is for expense tags). The fix: if `tag == 'other'` AND the transaction type has a natural display, use the type-based display instead.

### 5.10 Daily Summary Formatter — Cash Reconciliation

```python
def format_daily_summary(data: dict, store_name: str = 'Store') -> str:
    s    = data['summary']   # {type: {total, count}} from get_daily_summary
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

    # ... build AAYA section, GAYA section, BAAKI section ...

    # CASH RECONCILIATION — only shown if both income and closing are present
    if has_income and (cash or upi):
        total_in        = opening + sales + ud_r + receipts
        total_accounted = expenses + bank + ud_g + cash + upi
        diff            = round(total_in - total_accounted, 2)

        if abs(diff) < 1:
            "✅ Balanced!"
        elif diff > 0:
            f"⚠️ ₹{diff:,.0f} UNACCOUNTED → Cash gaya kahan? Check karo."
        else:
            f"ℹ️ ₹{abs(diff):,.0f} extra recorded than income → Koi income entry missing?"
```

The reconciliation only fires when both sides of the ledger are present (income AND closing cash/UPI). If only expenses are entered, it shows a note saying "balance check ke liye opening + income bhi dijiye."

---

## Part 6: The Webhook Layer (`moneybook_webhook.py`)

### 6.1 Server Setup and Imports

```python
from fastapi import FastAPI, Form, BackgroundTasks
from fastapi.responses import PlainTextResponse
from twilio.rest import Client as TwilioClient
from twilio.twiml.messaging_response import MessagingResponse
from apscheduler.schedulers.background import BackgroundScheduler

TWILIO_ACCOUNT_SID     = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN      = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_WHATSAPP_NUMBER = os.getenv('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+14155238886')

twilio = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
app    = FastAPI(title='MoneyBook', version='2.0')
```

Two Twilio clients in use:
1. `MessagingResponse` from `twilio.twiml` — generates XML for webhook responses (instant ack)
2. `TwilioClient` from `twilio.rest` — sends messages via REST API (async result push)

### 6.2 The Twilio Response Helper

```python
def twiml_reply(text: str) -> PlainTextResponse:
    r = MessagingResponse()
    r.message(text)
    return PlainTextResponse(str(r), media_type='application/xml')
```

Twilio expects a specific XML format (TwiML) as the webhook response. `MessagingResponse().message(text)` generates:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>your text here</Message></Response>
```

FastAPI's `PlainTextResponse` with `media_type='application/xml'` serves this correctly.

### 6.3 The REST Push Helper

```python
def send_whatsapp(to: str, body: str):
    try:
        twilio.messages.create(from_=TWILIO_WHATSAPP_NUMBER, to=to, body=body)
    except Exception as e:
        log.error(f"Twilio send error ({to}): {e}")
```

Used by background tasks to push results after processing. This goes through Twilio's HTTP API, not through the webhook response.

### 6.4 Command Detection

```python
COMMANDS = {
    '/summary': 'summary', 'summary': 'summary',
    'aaj ka hisaab': 'summary', 'aaj ka hisab': 'summary',
    '/udhaar': 'udhaar', 'udhaar': 'udhaar',
    '/month': 'month', 'is mahine': 'month', 'mahina': 'month',
    '/quarter': 'quarter', 'is quarter': 'quarter',
    '/year': 'year', 'is saal': 'year', 'saal': 'year',
    '/help': 'help', 'help': 'help',
}

def detect_command(text: str) -> Optional[str]:
    t = text.lower().strip()
    for trigger, action in COMMANDS.items():
        if t == trigger or t.startswith(trigger + ' '):
            return action
    return None
```

Supports both slash commands (`/summary`) and natural language (`aaj ka hisaab`). The `startswith` check allows extras like `/summary today` without breaking.

### 6.5 Period Date Calculation in `run_command`

```python
def run_command(action: str, store: dict) -> str:
    sid  = store['id']
    name = store.get('name', 'Store')
    today = date.today()

    if action == 'month':
        start = today.replace(day=1).isoformat()
        end   = today.isoformat()
        data  = get_period_summary(sid, start, end, label=today.strftime('%B %Y'))
        return format_period_summary(data, name)

    if action == 'quarter':
        q_start_month = ((today.month - 1) // 3) * 3 + 1   # Jan=1, Apr=4, Jul=7, Oct=10
        start = today.replace(month=q_start_month, day=1).isoformat()
        end   = today.isoformat()
        q_num = (today.month - 1) // 3 + 1
        data  = get_period_summary(sid, start, end, label=f'Q{q_num} {today.year}')
        return format_period_summary(data, name)

    if action == 'year':
        start = today.replace(month=1, day=1).isoformat()
        end   = today.isoformat()
        data  = get_period_summary(sid, start, end, label=f'Year {today.year}')
        return format_period_summary(data, name)
```

Quarter calculation: `((today.month - 1) // 3) * 3 + 1`. For month 3 (March): `((3-1)//3)*3+1 = (0)*3+1 = 1` → Q1 starts January. For month 7 (July): `((7-1)//3)*3+1 = (2)*3+1 = 7` → Q3 starts July.

### 6.6 The Main Webhook Handler

```python
@app.post('/whatsapp')
async def whatsapp_webhook(
    background_tasks: BackgroundTasks,
    From:               str = Form(...),       # WhatsApp sender number
    Body:               str = Form(default=''),
    NumMedia:           int = Form(default=0),
    MediaUrl0:          str = Form(default=None),   # URL of first attached media
    MediaContentType0:  str = Form(default=None),
):
    from_number = From
    body        = Body.strip()
    has_media   = NumMedia > 0 and MediaUrl0

    store = get_or_create_store(from_number)
    sid   = store['id']
```

Twilio sends form-encoded POST data. FastAPI's `Form(...)` extracts each field. `From` is the sender's WhatsApp number. `NumMedia` tells us how many attachments. `MediaUrl0` is the URL to download the first attachment (with Twilio auth required).

**Full message routing logic:**

```
1. Onboarding state == 'new'        → ask for store name → set 'awaiting_name'
2. Onboarding state == 'awaiting_name' → save name → set 'active' → show HELP
3. has_media == True                → add_task(process_image_and_reply) → instant ack
4. detect_command(body) is not None → clear bot state → run_command → return
5. bot_state.state == 'confirming'  → handle_confirming(body, store, state)
6. bot_state.state == 'correcting'  → handle_correcting(body, store, state)
7. bot_state.state == 'classifying' → handle_classifying(body, store, state)
8. Idle: detect_command again       → run_command
9. Idle: parse text → 1 transaction → auto-save → return
10. Idle: parse text → N transactions → set confirming state → show list
```

Commands always interrupt current state (step 4 runs before state machine check). This allows `/summary` to work even mid-conversation.

### 6.7 The Background Image Task

```python
def process_image_and_reply(from_number: str, media_url: str, body: str):
    try:
        store = get_or_create_store(from_number)
        sid   = store['id']
        ctx   = build_store_context(sid)   # inject per-store corrections

        parsed = parse_image_message(
            media_url, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
            store_context=ctx
        )
        txns          = [t for t in parsed.get('transactions', []) if t.get('amount', 0) > 0]
        persons_found = parsed.get('persons_found', [])
        page_date     = parsed.get('date')
        raw_ocr       = parsed.get('raw_ocr', '')

        if not txns:
            ocr_conf = parsed.get('ocr_confidence', 'high')
            if raw_ocr and ocr_conf in ('low', 'medium'):
                reply = (f"Kuch nahi mila 🤔\n\n"
                         f"*Maine yeh text padha:*\n_{raw_ocr[:400]}_\n\n"
                         f"Sahi hai? Ya clearer photo bhejiye.")
            else:
                reply = "Photo se kuch nahi mila 🤔\nClear photo bhejiye."
        else:
            set_bot_state(sid, {
                'state':          'confirming',
                'pending':        txns,
                'persons_found':  persons_found,
                'persons_map':    {},
                'raw_message':    body,
                'source':         'image',
                'page_date':      page_date,
                'raw_ocr':        raw_ocr,   # stored for use in save_correction() later
            })
            reply = format_pending_confirmation(txns, page_date)

        send_whatsapp(from_number, reply)   # push via REST API

    except Exception as e:
        log.error(f"Background image processing failed: {e}")
        send_whatsapp(from_number, f"⚠️ Photo process karne mein error: {str(e)[:100]}")
```

Note: `raw_ocr` is stored in bot state. When the owner makes a correction later, `handle_correcting()` pulls it from state and passes it to `save_correction()` as context. This makes corrections more meaningful — the model sees "correction made in the context of this image parse" rather than isolated.

### 6.8 State: CONFIRMING

```python
def handle_confirming(body: str, store: dict, state: dict) -> str:
    sid          = store['id']
    t            = body.strip().lower()
    pending      = state.get('pending', [])
    persons_found = state.get('persons_found', [])
    page_date    = state.get('page_date')
    persons_map  = state.get('persons_map', {})

    # 1. Cancel
    if t == 'cancel':
        clear_bot_state(sid)
        return "❌ Cancel ho gaya."

    # 2. Confirm all
    if t in ('haan', 'han', 'yes', 'ok', 'okay', 'sahi', '✅', 'haan sahi'):
        save_confirmed_batch(sid, pending, raw_message, source, persons_map)
        unknown = get_unknown_persons(sid, persons_found)
        if unknown:
            # Move to classifying state for first unknown person
            set_bot_state(sid, {'state': 'classifying', 'persons_queue': unknown, 'person_index': 0})
            return f"✅ {len(pending)} entries save!\n\n" + format_person_question(unknown[0], ...)
        else:
            clear_bot_state(sid)
            return f"✅ {len(pending)} entries save ho gayi!"

    # 3. Fix specific entry: "galat 3" or "3 galat"
    m = re.match(r'^galat\s+(\d+)$', t) or re.match(r'^(\d+)\s+galat$', t)
    if m:
        idx = int(m.group(1)) - 1   # convert to 0-based
        if 0 <= idx < len(pending):
            set_bot_state(sid, {**state, 'state': 'correcting', 'correcting_index': idx})
            entry = pending[idx]
            return f"✏️ Entry {idx+1} theek karo:\n_{entry['description']} — ₹{entry['amount']}_\nSahi info bhejein"

    # 4. Tag update: "3 tag electricity"
    m_tag = re.match(r'^(\d+)\s+tag\s+(\w+)$', t)
    if m_tag:
        idx, new_tag = int(m_tag.group(1)) - 1, m_tag.group(2)
        if 0 <= idx < len(pending) and new_tag in TAG_META:
            pending[idx]['tag'] = new_tag
            set_bot_state(sid, {**state, 'pending': pending})   # update state in-place
            return f"🏷️ Entry {idx+1} tag → {TAG_META[new_tag][1]}\n\n" + format_pending_confirmation(pending, page_date)

    # 5. Unrecognized
    return "Samajh nahi aaya 🤔\n• haan → save\n• galat 3 → fix entry 3\n• cancel"
```

The in-place tag update (`{**state, 'pending': pending}`) re-serializes the entire state dict to JSON and saves it. This keeps the state machine atomic.

### 6.9 State: CORRECTING

```python
def handle_correcting(body: str, store: dict, state: dict) -> str:
    sid      = store['id']
    idx      = state.get('correcting_index', 0)
    pending  = state.get('pending', [])
    original = pending[idx]

    # Call Claude to parse the correction text into a structured transaction
    corrected = parse_correction(original, body)
    pending[idx] = corrected

    # SAVE CORRECTION FOR PER-STORE LEARNING
    save_correction(
        store_id       = sid,
        raw_text       = state.get('raw_ocr', state.get('raw_message', '')),
        original_json  = original,
        corrected_json = corrected,
        entry_index    = idx + 1,
    )

    # Return to confirming state with updated pending list
    new_state = {**state, 'state': 'confirming', 'pending': pending}
    new_state.pop('correcting_index', None)
    set_bot_state(sid, new_state)

    return (f"✅ Entry {idx+1} update:\n_{corrected['description']} — ₹{corrected['amount']}_\n"
            "_(Yeh correction yaad rakh liya 🧠)_\n\n"
            + format_pending_confirmation(pending, state.get('page_date')))
```

Every correction triggers `save_correction()`. This is the learning loop: owner corrects → saved → next parse uses it as a few-shot example → accuracy improves for that store's specific patterns.

### 6.10 State: CLASSIFYING

After confirmation, if any `persons_found` are not yet in the `persons` table:

```python
def handle_classifying(body: str, store: dict, state: dict) -> str:
    sid   = store['id']
    queue = state.get('persons_queue', [])
    idx   = state.get('person_index', 0)
    choice = body.strip()

    PERSON_CATEGORIES = {'1': 'staff', '2': 'customer', '3': 'supplier', '4': 'home'}

    if choice not in PERSON_CATEGORIES:
        return "Please 1, 2, 3, ya 4 mein se choose karein"

    category = PERSON_CATEGORIES[choice]
    name     = queue[idx]
    save_person(sid, name, category)   # upsert into persons table

    # Advance to next unclassified person
    idx += 1
    unknown_remaining = [n for n in queue[idx:] if not get_person(sid, n)]

    if unknown_remaining:
        next_name = unknown_remaining[0]
        set_bot_state(sid, {**state, 'person_index': queue.index(next_name)})
        return f"✅ {name} → {category}\n\n" + format_person_question(next_name, 0, '')
    else:
        clear_bot_state(sid)
        return f"✅ {name} → {category}\n\nSab log register ho gaye! 🎉"
```

### 6.11 APScheduler — Scheduled Jobs

```python
_scheduler = BackgroundScheduler(timezone='Asia/Kolkata')
_scheduler.add_job(job_daily_summary, 'cron', hour=21, minute=0)
_scheduler.add_job(job_udhaar_alerts, 'cron', day_of_week='mon', hour=9)

@app.on_event('startup')
def on_startup():
    init_db()      # create/migrate database tables
    _scheduler.start()

@app.on_event('shutdown')
def on_shutdown():
    _scheduler.shutdown(wait=False)
```

`BackgroundScheduler(timezone='Asia/Kolkata')` runs in a separate thread within the same process. No external service needed.

**`job_daily_summary`** (9 PM daily):
```python
def job_daily_summary():
    for store in get_all_active_stores():
        data = get_daily_summary(store['id'])
        msg  = format_daily_summary(data, store.get('name', 'Store'))
        msg += "\n\n_📒 MoneyBook Daily Report_"
        send_whatsapp(store['phone'], msg)
```

**`job_udhaar_alerts`** (Monday 9 AM):
```python
def job_udhaar_alerts():
    for store in get_all_active_stores():
        aging = get_udhaar_aging(store['id'], days=30)   # balance > 0 AND last_txn > 30 days ago
        if not aging:
            continue
        lines = [f"⚠️ Purana Udhaar — {store.get('name','')}"]
        for u in aging:
            days = (date.today() - date.fromisoformat(u['last_transaction_date'])).days
            lines.append(f"• {u['person_name']}: ₹{u['balance']:,.0f} ({days} din)")
        send_whatsapp(store['phone'], '\n'.join(lines))
```

---

## Part 7: The Full Message Flow

Here is the complete end-to-end journey of a photo message from Ramesh's phone to saved database entries:

```
1. Ramesh takes a photo of his notebook page
2. Ramesh sends it via WhatsApp to +14155238886

3. WhatsApp → Twilio
   Twilio receives the message, uploads the image to its CDN
   Twilio sends POST to: https://xyz.trycloudflare.com/whatsapp
   Form data: From="whatsapp:+91...", NumMedia=1,
              MediaUrl0="https://api.twilio.com/...", Body=""

4. FastAPI webhook receives the POST
   → get_or_create_store("whatsapp:+91...") → store dict from SQLite
   → has_media = True
   → background_tasks.add_task(process_image_and_reply, from_number, MediaUrl0, body)
   → return TwiML: "📷 Photo mil gayi! Padh raha hoon... ⏳"
   [< 100ms elapsed — Twilio timeout satisfied]

5. Twilio receives TwiML response
   → Delivers "📷 Photo mil gayi!" to Ramesh's WhatsApp
   → Connection closed

6. FastAPI background thread picks up the task
   → build_store_context(store_id) → queries store_corrections → builds few-shot string
   → httpx.get(MediaUrl0, auth=(SID, TOKEN), follow_redirects=True)
      (Twilio CDN issues 307 → httpx follows → gets actual image bytes)
   → base64.b64encode(image_bytes)
   → anthropic.messages.create(
         model="claude-sonnet-4-5",
         messages=[{
             "role": "user",
             "content": [
                 {"type": "image", "source": {"type": "base64", "data": "..."}},
                 {"type": "text",  "text": _IMAGE_PARSE_PROMPT.format(...)}
             ]
         }]
      )
   [20-40 seconds elapsed]

7. Claude returns JSON:
   {"date": "2026-03-27", "transactions": [
     {"type": "opening_balance", "amount": 41189, ...},
     {"type": "receipt",         "amount": 1000,  "person_name": "Rohit", ...},
     {"type": "sale",            "amount": 112923, ...},
     {"type": "expense",         "amount": 60,    "description": "Phenyl", "tag": "cleaning"},
     {"type": "expense",         "amount": 395,   "description": "CD Vivek Singh", "tag": "cash_discount"},
     {"type": "upi_in_hand",     "amount": 10898, ...},
     {"type": "cash_in_hand",    "amount": 42129, ...}
   ], "persons_found": ["Rohit", "Vivek Singh"], ...}

8. process_image_and_reply sets bot_state:
   {state: "confirming", pending: [...7 transactions...],
    persons_found: ["Rohit", "Vivek Singh"], raw_ocr: "[single-pass]", ...}
   → saves to stores.bot_state column in SQLite

9. send_whatsapp(from_number, format_pending_confirmation(txns, page_date))
   → twilio.messages.create(from_="whatsapp:+14155238886", to="whatsapp:+91...", body="📋 Maine padha...")
   → Twilio delivers to Ramesh's WhatsApp [~ 40 seconds after step 2]

10. Ramesh reads the list, types "haan"

11. Twilio sends new POST to webhook
    → handle_confirming("haan", store, state)
    → save_confirmed_batch() → calls add_transaction() 7 times
       (dedup check runs each time — all pass since fresh)
    → udhaar auto-updated for Rohit (receipt) if applicable
    → unknown persons ["Rohit", "Vivek Singh"] found
    → set_bot_state({state: "classifying", persons_queue: ["Rohit", "Vivek Singh"], ...})
    → return "✅ 7 entries save!\n\n👤 Rohit kaun hai?..."

12. Ramesh types "2" (Customer)
    → save_person(store_id, "Rohit", "customer")
    → next: "Vivek Singh"

13. Ramesh types "3" (Supplier)
    → save_person(store_id, "Vivek Singh", "supplier")
    → clear_bot_state() → back to idle
    → "Sab register! 🎉"
```

---

## Part 8: Every Bug, Root Cause, and Fix

### Bug 1: `load_dotenv()` Not Finding `.env`
**Symptom:** `ANTHROPIC_API_KEY is None`. Server starts, API call fails.
**Root cause:** `load_dotenv()` searches from `os.getcwd()`. When scripts are imported by uvicorn, CWD may not be the project root. The `.env` file at `/go/.env` isn't found from `/go/execution/`.
**Fix:** `load_dotenv(Path(__file__).resolve().parent.parent / '.env', override=True)` — absolute path, always resolves correctly regardless of CWD.
**Applied in:** All 3 execution files.

### Bug 2: Twilio Image `307 Temporary Redirect`
**Symptom:** `Image error: Redirect response '307 Temporary Redirect'`
**Root cause:** Twilio stores media on a CDN that issues HTTP 307 redirects to the actual storage URL. Default `httpx.get()` does not follow redirects.
**Fix:** `httpx.get(url, auth=auth, timeout=40, follow_redirects=True)`
**Applied in:** `parse_image_message()` in parser.py.

### Bug 3: Twilio 15-Second Webhook Timeout
**Symptom:** Image sent. Bot replies "📷 Photo mil gayi!" then nothing. No transaction list ever arrives.
**Root cause:** Twilio hard-kills webhook connections at 15 seconds. Claude Sonnet vision takes 20-40 seconds. The webhook handler was processing the image synchronously and never completing before the timeout.
**Fix:** `FastAPI BackgroundTasks`. Webhook returns TwiML ack instantly (<1s). Image processing runs in background thread. Result pushed via `twilio.messages.create()` REST API call.
**Applied in:** `whatsapp_webhook()` and new `process_image_and_reply()` function in webhook.py.

### Bug 4: Gemini 429 Quota Exceeded
**Symptom:** `Image error: 429 You exceeded your current quota, please check your plan and billing details.`
**Root cause:** Google Gemini free tier: 15 requests/minute, strict daily limits. Hit mid-session.
**Fix:** Rewrote entire parser to use Anthropic Claude API. Changed model constants from `gemini-2.5-flash` to `claude-haiku-4-5` (text) and `claude-sonnet-4-5` (vision). Changed API client from `google.genai` to `anthropic.Anthropic`. Also updated `generate_knowledge_doc.py` to use Claude instead of Gemini.
**Applied in:** Entire moneybook_parser.py rewritten.

### Bug 5: Deprecated Claude Model Names
**Symptom:** `model not found` error from Anthropic API.
**Root cause:** Anthropic renamed their models. `claude-3-5-haiku-20241022` and `claude-3-5-sonnet-20241022` (old names) no longer work.
**Fix:** `claude-haiku-4-5` and `claude-sonnet-4-5` (new names, March 2026).
**Applied in:** `_TEXT_MODEL` and `_VISION_MODEL` constants in parser.py.

### Bug 6: `/summary` Shows Only Header
**Symptom:** Ramesh types `/summary`. Gets `📊 2026-03-28 — Swayamvar Garhwa` with nothing below it.
**Root cause:** `get_daily_summary()` queried `WHERE date = '2026-03-28'` (today). All data was entered on `2026-03-27` (yesterday). Zero rows returned. Formatter built the header from `store_name` but had no summary data to render.
**Fix:** After querying today and getting 0 rows, fall back to `SELECT date FROM transactions WHERE store_id=? ORDER BY date DESC LIMIT 1` and use that date instead.
**Applied in:** `get_daily_summary()` in db.py.

### Bug 7: Duplicate Transactions
**Symptom:** After one confirmation session, 14 rows appear in DB instead of 7.
**Root cause:** Owner accidentally typed "haan" twice. Both triggers called `save_confirmed_batch()` which called `add_transaction()` 7 times each. No guard against duplicates.
**Fix:** In `add_transaction()`, before INSERT: `SELECT id FROM transactions WHERE store_id=? AND date=? AND type=? AND amount=? AND created_at >= datetime('now', '-10 minutes')`. If found, return existing ID without inserting.
**Applied in:** `add_transaction()` in db.py.

### Bug 8: Missing "60 - Phenyl" Entry (The Critical Accuracy Bug)
**Symptom:** Notebook photo has 7 entries. Bot returns 6. "60 - Finail (Phenyl)" missing.
**Root cause:** Two-pass OCR pipeline. Pass 1 (Sonnet) extracted raw text from image. In the text, "60 - Finail" at the top of the right column lost its 2D spatial context — the fact that it was in the right/expense column was not encoded in the text output. Pass 2 (Haiku) received a flat text string and either skipped the ambiguous entry or couldn't determine its transaction type.
**Proof:** Same image shown directly to Claude in chat (single-pass, full image context) → all 7 entries found including Phenyl.
**Fix:** Single-pass vision. One call to Sonnet with image + structured output prompt. Sonnet sees the full 2D layout and produces JSON directly.
**Applied in:** `parse_image_message()` completely rewritten. Removed `_OCR_PROMPT` and `_STRUCTURE_PROMPT`. Added `_IMAGE_PARSE_PROMPT`.

### Bug 9: Sale Amount `11,292` Instead of `1,12,923`
**Symptom:** Sale entry saved as ₹11,292. Actual amount was ₹1,12,923 (one lakh twelve thousand nine hundred twenty-three).
**Root cause:** Indian comma format (`1,12,923`) differs from Western (`112,923`). The model was applying Western interpretation and occasionally dropping a digit when the comma placement didn't match its training distribution.
**Fix:** Added explicit rule to `_IMAGE_PARSE_PROMPT`:
```
1,12,923 = parts [1][12][923] → concatenate → 112923
NEVER drop digits. Count every digit character.
```
**Applied in:** `_IMAGE_PARSE_PROMPT` in parser.py.

### Bug 10: `OPI` Instead of `UPI`
**Symptom:** UPI total tagged as "OPI" with tag `other`.
**Root cause:** In handwritten Indian cashbooks, "U" and "O" are frequently indistinguishable. Model read "OPI" and had no lookup to connect it to UPI.
**Fix:** Added to misspellings section of `_IMAGE_PARSE_PROMPT`:
```
OPI / 0PI / UPl → UPI (U and O look alike; I and l look alike)
```
**Applied in:** `_IMAGE_PARSE_PROMPT` in parser.py.

### Bug 11: Gemini Model `gemini-2.5-flash-preview-05-20` Not Found
**Symptom:** `generate_knowledge_doc.py` fails with `404 NOT_FOUND` on Gemini API.
**Root cause:** Model was renamed from `gemini-2.5-flash-preview-05-20` to `gemini-2.5-flash`.
**Fix:** Updated model name. Then hit 429 quota. Final fix: migrated `generate_knowledge_doc.py` to use Anthropic Claude API (`claude-haiku-4-5`) instead of Gemini for text generation.
**Applied in:** `generate_knowledge_doc.py` — replaced entire Gemini client with Anthropic client.

### Bug 12: Non-Expense Types Show `📝 Other`
**Symptom:** In the confirmation list, opening balance, cash in hand, UPI all show `📝 Other` instead of meaningful icons.
**Root cause:** `format_pending_confirmation()` looked up `TAG_META` for every entry. `TAG_META` is an expense tag dictionary. Non-expense transaction types (`opening_balance`, `cash_in_hand`, `upi_in_hand`) don't have meaningful expense tags — the AI correctly sets `tag: "other"` for them. But `other` → `📝 Other` looks bad and is confusing.
**Fix:** Added `_TYPE_META` dict inside the formatter:
```python
_TYPE_META = {
    'opening_balance': ('🔓', 'Opening Balance'),
    'cash_in_hand':    ('💵', 'Cash in Hand'),
    'upi_in_hand':     ('📱', 'UPI in Hand'),
    ...
}
# If tag == 'other' AND type has a natural display → use type-based display
if tag == 'other' and txn_type in _TYPE_META:
    emoji, label = _TYPE_META[txn_type]
```
**Applied in:** `format_pending_confirmation()` in parser.py.

---

## Part 9: How to Run This From Scratch

```bash
# 1. Create project directory and .env
mkdir -p /go/.tmp
cat > /go/.env << EOF
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
EOF

# 2. Install dependencies
pip install fastapi uvicorn twilio anthropic apscheduler httpx python-dotenv

# 3. Start server
cd /go
uvicorn execution.moneybook_webhook:app --host 0.0.0.0 --port 8000 --reload

# 4. Start tunnel (new terminal)
cloudflared tunnel --url http://localhost:8000
# → copies URL like https://abc-xyz.trycloudflare.com

# 5. Set Twilio webhook
# Go to console.twilio.com → Messaging → Try it out → Send a WhatsApp message
# "When a message comes in": https://abc-xyz.trycloudflare.com/whatsapp  [HTTP POST]

# 6. Join the sandbox on WhatsApp
# Send "join <sandbox-word>" to +14155238886
# Then send any message — bot will ask for store name

# 7. Verify health
curl http://localhost:8000/health
# → {"status":"ok","service":"MoneyBook v2","date":"2026-03-28"}
```

⚠️ **Cloudflared URL changes every restart.** Must update Twilio console each time. For production: deploy to Railway or Render for a fixed URL.

⚠️ **Anthropic credits required.** API key is valid but balance must be > $0. Add at `console.anthropic.com → Plans & Billing`.

---

## Part 10: What's Not Yet Built

| Feature | Status | Notes |
|---------|--------|-------|
| Fixed deployment URL | ❌ | Using cloudflared ephemeral tunnel. Needs Railway/Render |
| Anthropic credits | ❌ | Must be added before bot works |
| Multi-page notebook | ❌ | One image = one page only |
| Correction learning validation | ❌ | Corrections saved but not tested end-to-end |
| StockSense module | ❌ | Inventory tracking from bills — separate discussion |
| ShopEye module | ❌ | Camera analytics — separate discussion |
| Dashboard | ⏳ | `moneybook_dashboard.py` exists but not wired up |
| Visuals in knowledge docs | ❌ | Needs Gemini image generation quota/credits |
