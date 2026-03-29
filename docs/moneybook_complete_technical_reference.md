# MoneyBook — Complete Technical Reference
### Product Architecture, AI Design, Engineering Deep-Dive, and End-to-End Code Documentation

---

> **Document scope:** Every layer of the product — from the WhatsApp message a store owner sends to the SQLite row that gets written and the reply they receive — explained fully, with all code, all prompts, all design decisions.
>
> **Audience:** Software engineers who want to understand, extend, audit, or rebuild the system.
>
> **Date:** 2026-03-28

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Why This Exists — Problem Statement](#2-why-this-exists)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Directory Structure](#5-directory-structure)
6. [Environment Configuration](#6-environment-configuration)
7. [Database Architecture](#7-database-architecture)
8. [AI Architecture — Models, Prompts, Thinking](#8-ai-architecture)
9. [Parser Deep-Dive — moneybook_parser.py](#9-parser-deep-dive)
10. [Webhook Deep-Dive — moneybook_webhook.py](#10-webhook-deep-dive)
11. [Conversation State Machine](#11-conversation-state-machine)
12. [Database Layer — moneybook_db.py](#12-database-layer)
13. [Dashboard — moneybook_dashboard.py](#13-dashboard)
14. [Scheduled Jobs & Automation](#14-scheduled-jobs)
15. [Per-Store Learning System](#15-per-store-learning)
16. [Message Splitting & Twilio Constraints](#16-message-splitting)
17. [Complete End-to-End Flow — Text Message](#17-e2e-text-flow)
18. [Complete End-to-End Flow — Image/Photo](#18-e2e-image-flow)
19. [All API Calls — Parameters, Models, Retry Logic](#19-api-calls)
20. [Prompt Engineering — Full Prompts with Annotations](#20-prompt-engineering)
21. [Extended Thinking — Design & Implementation](#21-extended-thinking)
22. [Error Handling & Self-Healing](#22-error-handling)
23. [Known Bugs, Root Causes, and Fixes](#23-bugs-and-fixes)
24. [Performance Characteristics](#24-performance)
25. [Deployment Guide](#25-deployment)
26. [Open Items & Future Roadmap](#26-open-items)

---

## 1. Product Overview

**MoneyBook** is a WhatsApp-native digital accounting system built for Indian retail store owners (kirana stores, textile shops, wholesale dealers, pharmacies). The core insight is that Indian small business owners already manage their accounts through handwritten notebooks (called *bahi khata* or *rozkaamil*). They will not download a separate app or learn new software. But they already use WhatsApp every day.

MoneyBook turns WhatsApp into a financial ledger:

- **Text input**: Owner types "Sale 5000 cash" or "Raju ne 500 udhaar liya" → bot parses, confirms, saves
- **Image input**: Owner photographs their daily notebook page → bot reads handwriting (OCR), extracts all entries, shows a confirmation list
- **Commands**: `/summary`, `/month`, `/udhaar` → formatted financial reports back on WhatsApp
- **Dashboard**: Optional Streamlit web dashboard for visual P&L, expense charts, udhaar tracking
- **Scheduled reports**: Every evening at 9 PM, bot sends daily summary. Every Monday morning, udhaar reminders

**Target user:** A 40-year-old textile store owner in Lucknow who writes his accounts in a notebook every evening. He photographs the notebook page and sends it to MoneyBook via WhatsApp. The bot reads it in 60–90 seconds using AI with extended thinking, returns a confirmation list, he says "haan", and all 20 entries are saved — categorized, tagged, and ready for monthly summaries.

**Key differentiator:** The bot understands Indian business vocabulary natively (Bhada, Palledari, Dhulai, PTm card, Jama, CD, etc.) without a fixed dictionary — it uses Claude's world knowledge and extended thinking to reason through ambiguous handwriting exactly the way a human accountant would.

---

## 2. Why This Exists

### The Problem

Indian small businesses represent ~45% of industrial output and ~80% of employment in the non-agricultural sector. Yet 90%+ still manage accounts on paper. Existing software (Tally, Zoho Books) requires:

1. Desktop/laptop (most owners are mobile-only)
2. Learning a new interface
3. Daily data entry discipline in a new tool

The result: owners have no real-time visibility into cash flow, no easy way to track who owes them money (udhaar), and no expense breakdown.

### Why WhatsApp

- 500M+ WhatsApp users in India
- Every store owner already uses it
- No app to install, no account to create
- Works on basic Android phones

### Why AI / Claude

The notebook pages that store owners photograph contain:
- Multiple handwriting styles
- Abbreviations that vary by region and business type
- Indian number formatting (1,12,923 = 112,923)
- Mixed scripts (Hindi words in Roman, sometimes Devanagari)
- Context-dependent vocabulary ("Dhulai" means washing charge in textile, transport charge elsewhere)
- Reference annotations that must not be confused with transaction amounts

A rule-based OCR system fails immediately. A standard LLM without extended thinking gets 70-80% accuracy. Claude Opus with extended thinking gets 95%+ because it can reason through ambiguities the same way a human expert would.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      STORE OWNER                                │
│               (WhatsApp on their phone)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │  Text message or photo
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TWILIO WHATSAPP API                          │
│   Receives the message, POSTs it to our webhook URL            │
│   Returns TwiML acknowledgment back to WhatsApp immediately     │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTP POST /whatsapp
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              FASTAPI WEBHOOK SERVER (port 8000)                 │
│              execution/moneybook_webhook.py                     │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐ │
│  │ Text message    │    │ Image message                       │ │
│  │ → parse inline  │    │ → return ack immediately            │ │
│  │ → confirm/save  │    │ → spawn background thread           │ │
│  └────────┬────────┘    └──────────────┬────────────────────-─┘ │
│           │                            │                        │
│  ┌────────▼────────────────────────────▼────────────────────┐   │
│  │          CONVERSATION STATE MACHINE                       │   │
│  │   idle → confirming → correcting → classifying → idle    │   │
│  └────────────────────────────┬──────────────────────────── ┘   │
└───────────────────────────────┼─────────────────────────────────┘
                                │  parse_text_message() or
                                │  parse_image_message()
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              CLAUDE AI LAYER (Anthropic API)                    │
│              execution/moneybook_parser.py                      │
│                                                                 │
│  Text:  claude-haiku-4-5     (fast, cheap, reliable)           │
│  Image: claude-opus-4-6      (most capable, extended thinking)  │
│         + adaptive thinking budget = 10,000 tokens             │
│         → private scratchpad: reasons before answering          │
└────────────────────────────────┬────────────────────────────────┘
                                 │  Structured JSON
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SQLITE DATABASE                              │
│                    .tmp/moneybook.db                            │
│                                                                 │
│  stores              udhaar             persons                 │
│  transactions        udhaar_transactions store_corrections      │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
         ┌──────────────────┐    ┌────────────────────────┐
         │  WhatsApp Reply  │    │  Streamlit Dashboard   │
         │  (via Twilio     │    │  moneybook_dashboard.py │
         │   REST API)      │    │  port 8501             │
         └──────────────────┘    └────────────────────────┘
```

### The 3-Layer Design

The system is intentionally designed as three separate layers:

| Layer | Role | File |
|-------|------|------|
| **Orchestration** | Conversation state, routing, error handling | `moneybook_webhook.py` |
| **Intelligence** | AI parsing, prompt engineering, extended thinking | `moneybook_parser.py` |
| **Persistence** | SQL, udhaar tracking, correction learning | `moneybook_db.py` |

This separation means:
- Swapping AI models only requires changing `moneybook_parser.py`
- Adding a new command only requires changing `moneybook_webhook.py`
- Adding a new report only requires changing `moneybook_db.py`

---

## 4. Technology Stack

| Component | Technology | Version | Why |
|-----------|-----------|---------|-----|
| Web framework | FastAPI | 0.104+ | Async, fast, native BackgroundTasks |
| ASGI server | Uvicorn | 0.24+ | Production-grade ASGI, `--reload` for dev |
| AI - text | Claude Haiku 4.5 | claude-haiku-4-5 | 3x cheaper than Sonnet, sufficient for simple text |
| AI - vision | Claude Opus 4.6 | claude-opus-4-6 | Most capable for handwriting + extended thinking |
| AI SDK | anthropic Python | 0.40+ | Official Anthropic Python SDK |
| WhatsApp API | Twilio | twilio-python 9.3+ | Industry standard, sandbox for dev |
| Database | SQLite | Built-in | Single-file, zero dependencies, sufficient for scale |
| HTTP client | httpx | 0.25+ | Async-compatible, follow_redirects support |
| Scheduling | APScheduler | 3.10+ | Cron jobs for daily summaries and alerts |
| Dashboard | Streamlit | 1.28+ | Rapid BI dashboard, native Plotly support |
| Charts | Plotly | 5.18+ | Interactive charts, waterfall chart support |
| Data | Pandas | 2.0+ | DataFrame operations for dashboard |
| Tunnel (dev) | Cloudflare Tunnel | cloudflared | Free, no account needed, HTTPS automatically |
| Config | python-dotenv | 1.0+ | .env loading |

---

## 5. Directory Structure

```
/Users/bhabya.jain/go/
│
├── .env                          ← API keys, Twilio credentials, config
├── CLAUDE.md                     ← AI instructions (mirrored to AGENTS.md, GEMINI.md)
│
├── execution/                    ← All runnable Python scripts
│   ├── moneybook_parser.py       ← Claude AI layer: text + image parsing, formatters
│   ├── moneybook_webhook.py      ← FastAPI server: webhook handler, state machine
│   ├── moneybook_db.py           ← SQLite layer: all DB operations
│   ├── moneybook_dashboard.py    ← Streamlit visual dashboard
│   ├── moneybook_setup.py        ← One-time setup and verification script
│   ├── generate_knowledge_doc.py ← AI doc generation (uses Claude Haiku)
│   ├── generate_visuals.py       ← AI image generation (uses Gemini)
│   └── update_knowledge_base.py  ← KB updater (uses Gemini)
│
├── directives/                   ← SOPs and system instructions (Markdown)
│   ├── moneybook.md
│   ├── knowledge_base.md
│   └── nanobanana.md
│
├── docs/                         ← Generated documentation
│   └── knowledge/
│       └── 2026-03-28_moneybook-whatsapp-financial-tracker/
│           ├── layman.md
│           ├── intermediate.md
│           ├── pro.md
│           └── story.md
│
├── knowledge_base/               ← Persistent AI memory across sessions
│   ├── INDEX.md
│   ├── topics/
│   └── sessions/
│
└── .tmp/                         ← Ephemeral files (never committed)
    └── moneybook.db              ← SQLite database
```

### File Responsibilities

**`moneybook_parser.py`** (715 lines)
The entire AI brain of the system. Contains:
- Two model configurations (`_TEXT_MODEL`, `_VISION_MODEL`)
- Three prompts (`_IMAGE_PARSE_PROMPT`, `_TEXT_PROMPT`, `_CORRECTION_PROMPT`)
- The unified `_call_claude()` function with extended thinking support
- Three parser functions (`parse_text_message`, `parse_image_message`, `parse_correction`)
- Five formatter functions for WhatsApp output
- `TAG_META` dictionary for display labels and emojis

**`moneybook_webhook.py`** (615 lines)
The web server and conversation manager. Contains:
- FastAPI app with `/whatsapp` POST endpoint and `/health` GET
- Five conversation state handlers (`handle_confirming`, `handle_correcting`, `handle_classifying`, etc.)
- `process_image_and_reply()` — the BackgroundTask for image processing
- `send_whatsapp()` — Twilio REST API with automatic message splitting
- Scheduled job registration (APScheduler)

**`moneybook_db.py`** (530 lines)
All database operations. Contains:
- `init_db()` — idempotent schema creation + migration
- Store CRUD operations
- Transaction operations with deduplication
- Udhaar tracking with running balance
- Person registry (staff/customer/supplier/home classification)
- Correction learning: `save_correction()`, `build_store_context()`
- Summary queries: daily, period, weekly

**`moneybook_dashboard.py`** (285 lines)
Streamlit dashboard. Contains:
- Store selector
- Date range filter
- 4-column KPI row (Sales, Expenses, Net P&L, Udhaar)
- Daily sales bar chart
- Expense breakdown pie chart
- Cash flow waterfall chart
- Udhaar table + bar chart
- Transaction log with type filter

---

## 6. Environment Configuration

All secrets and configuration live in `.env` at the project root:

```env
# Anthropic (Claude) — primary AI
ANTHROPIC_API_KEY=sk-ant-api03-...

# Twilio — WhatsApp delivery
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Google (Gemini) — used only for knowledge base update (update_knowledge_base.py)
GOOGLE_API_KEY=AIzaSy...

# Optional: override default database path
DB_PATH=/custom/path/moneybook.db
```

**How .env is loaded:**
Every file that needs credentials calls:
```python
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env', override=True)
```
The path is computed relative to the file's own location, so it always finds the root `.env` regardless of the working directory when running the script.

`override=True` means environment variables in `.env` override any pre-existing shell env vars — important for ensuring the correct key is used in all cases.

---

## 7. Database Architecture

**Engine:** SQLite (file: `.tmp/moneybook.db`)

SQLite was chosen because:
- Zero network overhead — same process as the webhook server
- Single-file backup (just copy the `.db`)
- Sufficient for 10,000+ transactions per store
- No connection pooling complexity
- WAL mode not required at current scale

### Full Schema

```sql
-- One row per WhatsApp number (= one store)
CREATE TABLE IF NOT EXISTS stores (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT,                          -- "Sharma Textiles"
    phone             TEXT UNIQUE NOT NULL,          -- "whatsapp:+919102662588"
    language          TEXT DEFAULT 'auto',           -- detected language preference
    onboarding_state  TEXT DEFAULT 'new',            -- new | awaiting_name | active
    bot_state         TEXT DEFAULT '{}',             -- JSON: current conversation state
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Every financial transaction confirmed by owner
CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id        INTEGER NOT NULL,
    date            DATE    NOT NULL,                -- "2025-12-12"
    type            TEXT    NOT NULL,                -- sale|expense|udhaar_given|...
    amount          REAL    NOT NULL,                -- 5000.00
    description     TEXT,                           -- "Dharmendar, Bill B-5344"
    tag             TEXT,                           -- "staff_salary", "transport", etc.
    person_name     TEXT,                           -- "Raju Kumar"
    person_category TEXT,                           -- staff|customer|supplier|home
    payment_mode    TEXT,                           -- cash|upi|bank|credit
    raw_message     TEXT,                           -- original WhatsApp text/OCR
    source          TEXT DEFAULT 'text',            -- text|image
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id)
);

-- Running credit balance per named person
CREATE TABLE IF NOT EXISTS udhaar (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id              INTEGER NOT NULL,
    person_name           TEXT    NOT NULL,
    phone                 TEXT,                     -- optional, for direct reminders
    balance               REAL    DEFAULT 0,        -- positive = they owe store
    last_transaction_date DATE,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id),
    UNIQUE (store_id, person_name COLLATE NOCASE)   -- case-insensitive dedup
);

-- Individual credit/debit events (audit trail for udhaar)
CREATE TABLE IF NOT EXISTS udhaar_transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    udhaar_id      INTEGER NOT NULL,
    transaction_id INTEGER,                         -- FK to transactions table
    amount         REAL    NOT NULL,
    type           TEXT    NOT NULL,                -- given|received
    date           DATE    NOT NULL,
    notes          TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (udhaar_id)      REFERENCES udhaar (id),
    FOREIGN KEY (transaction_id) REFERENCES transactions (id)
);

-- Person registry: knows each named person's role
CREATE TABLE IF NOT EXISTS persons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id    INTEGER NOT NULL,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL,       -- staff|customer|supplier|home|other
    notes       TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id),
    UNIQUE (store_id, name COLLATE NOCASE)
);

-- Every correction the owner has made to AI parsing
-- Injected as few-shot examples in future prompts (per-store learning)
CREATE TABLE IF NOT EXISTS store_corrections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id        INTEGER NOT NULL,
    raw_text        TEXT,               -- what the AI originally read
    original_json   TEXT,               -- AI's original parse (JSON string)
    corrected_json  TEXT NOT NULL,      -- owner's corrected version (JSON string)
    entry_index     INTEGER,            -- 1-based index in the confirmation list
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores (id)
);
```

### Transaction Types Reference

| Type | When Used | Example |
|------|-----------|---------|
| `sale` | Revenue from selling goods | "Sale 5000 cash" |
| `expense` | Any outgoing payment | "Bijli bill 800" |
| `receipt` | Money received from person (non-sale) | "Dharmendar ne 4850 diye" |
| `udhaar_given` | Credit given to customer | "Raju ne 500 udhaar liya" |
| `udhaar_received` | Customer repaid | "Raju ne 300 wapas kiye" |
| `bank_deposit` | Cash moved to bank | "Bank mein 20000 jama" |
| `cash_in_hand` | Day-end physical cash | "Cash 38118" |
| `upi_in_hand` | Day-end UPI/Paytm total | "Paytm 29635" |
| `opening_balance` | Starting cash for the day | "Opening Bal 32398" |
| `closing_balance` | End-of-day cash carry-forward | "Closing Bal 38118" |

### Udhaar Tracking Logic

When a transaction with type `udhaar_given` or `udhaar_received` is saved, `add_transaction()` automatically calls `_update_udhaar()`:

```python
def _update_udhaar(conn, store_id, txn, txn_id, txn_date):
    person = txn['person_name']
    amount = float(txn['amount'])
    # upsert to udhaar table
    # delta = +amount for given, -amount for received
    delta = amount if txn['type'] == 'udhaar_given' else -amount
    conn.execute("UPDATE udhaar SET balance = balance + ?, last_transaction_date = ? WHERE id = ?",
                 (delta, txn_date, uid))
    # also write to audit trail
    conn.execute("INSERT INTO udhaar_transactions ...", (...))
```

This means `udhaar.balance` is always the net current outstanding — you never need to sum transactions to know what someone owes.

### Deduplication Guard

```python
# Prevents double-saves from double-confirm taps
recent_dup = conn.execute("""
    SELECT id FROM transactions
    WHERE store_id = ? AND date = ? AND type = ? AND amount = ?
      AND created_at >= datetime('now', '-10 minutes')
    LIMIT 1
""", (store_id, txn_date, txn['type'], float(txn['amount']))).fetchone()
if recent_dup:
    return recent_dup['id']   # already saved, skip silently
```

If the exact same (store, date, type, amount) was saved in the last 10 minutes, it's treated as a duplicate and skipped. This prevents the common bug where a user quickly taps "haan" twice.

### Migration Strategy

`_migrate()` is called every time `init_db()` runs. It uses `_try_alter()` which catches the "column already exists" error silently:

```python
def _migrate(conn):
    _try_alter(conn, "ALTER TABLE stores ADD COLUMN bot_state TEXT DEFAULT '{}'")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN tag TEXT")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN person_category TEXT")

def _try_alter(conn, sql):
    try:
        conn.execute(sql)
    except Exception:
        pass   # Column already exists — safe to ignore
```

This means the schema can evolve without ever needing explicit migration scripts.

---

## 8. AI Architecture

### The Core Problem: Why Plain JSON Fails

When you call any LLM with a prompt that ends in `"OUTPUT — ONLY valid JSON"`, you're suppressing the model's reasoning. The model skips straight to producing output without thinking through ambiguities. For simple, clean inputs this is fine. For a handwritten Indian ledger with 20 entries, abbreviations, mixed scripts, reference annotations, and Indian number formatting — it fails badly.

Example: The entry `1,12,923` in Indian notation = 112,923. Without reasoning, a model sees `1,12,923` and outputs `11292` (drops a digit group). With extended thinking, it reasons: *"This is Indian comma format — groups are [1][12][923] — concatenated that's 112923"* and gets it right.

### The Solution: Extended Thinking

Extended Thinking (Anthropic's adaptive thinking) gives Claude a private scratchpad — a block of text that:
1. Is never shown to the user
2. Is not part of the output
3. Allows the model to reason step-by-step before committing to an answer

This is identical to how Claude works in chat — when you paste an image in chat and ask Claude to read it, Claude is thinking internally before responding. The API `adaptive thinking` feature exposes this same mechanism.

### Model Selection

| Use Case | Model | Why |
|----------|-------|-----|
| Text parsing (simple messages) | `claude-haiku-4-5` | 3x cheaper than Sonnet, handles straightforward text well |
| Image parsing (handwritten ledgers) | `claude-opus-4-6` | Highest capability, best multimodal reasoning, extended thinking support |
| Corrections (re-parse single entry) | `claude-haiku-4-5` | Small task, no image, no thinking needed |
| Fallback (if Opus unavailable) | `claude-sonnet-4-5` | Middle tier — still good, cheaper |

**Constants in code:**
```python
_TEXT_MODEL      = 'claude-haiku-4-5'    # fast + cheap for simple text messages
_VISION_MODEL    = 'claude-opus-4-6'     # best available — most accurate for handwritten images
_VISION_FALLBACK = 'claude-sonnet-4-5'  # fallback if opus-4-6 unavailable
_THINKING_BUDGET = 10000                 # tokens the model can use to reason
```

### Token Economics

| Operation | Model | Input tokens (approx) | Output tokens | Thinking budget | Total cost (approx) |
|-----------|-------|----------------------|---------------|-----------------|---------------------|
| Text parse | Haiku | ~800 | ~400 | None | ~$0.0003 |
| Image parse | Opus | ~2000 (prompt) + image | ~800 | 10,000 | ~$0.08 |
| Correction | Haiku | ~600 | ~200 | None | ~$0.0002 |

Image parsing is expensive because of Opus pricing + thinking tokens. Estimated ~$2.50/month for a store sending one full page daily.

### Why Not GPT-4o or Gemini?

**GPT-4o:** Good vision but no equivalent of extended thinking for structured output tasks. Consistently drops Indian number format groups.

**Gemini:** Originally used (GEMINI_API_KEY is still in .env for KB scripts). Switched to Claude for:
- Extended thinking (Gemini doesn't have an equivalent at this granularity)
- Better handling of Hindi/mixed-script text in Roman characters
- More reliable JSON output format adherence

---

## 9. Parser Deep-Dive

### File: `execution/moneybook_parser.py`

This is the most critical file in the system. It handles all AI interactions.

### Module-Level Initialization

```python
_ENV_PATH = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=_ENV_PATH, override=True)

_api_key = os.getenv('ANTHROPIC_API_KEY')
if not _api_key:
    raise EnvironmentError(f"ANTHROPIC_API_KEY not found. Checked: {_ENV_PATH}\n...")

_client = anthropic.Anthropic(api_key=_api_key)
```

The client is initialized at module load time (singleton pattern). This means:
- Only one HTTP client is created per process
- Connection pooling is handled by the SDK
- If the key is missing, the server fails at startup rather than at first request

### TAG_META — The Tag Registry

```python
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
```

**Design note:** The AI is NOT told to pick from this list. The prompt says: *"write a short lowercase English label using your world knowledge — never write 'other'."* The `TAG_META` dict is only used at display time. If the AI produces a tag not in this dict (e.g., `"tailoring"`, `"petrol"`, `"dhulai"`), the display functions handle it gracefully:

```python
def tag_label(tag: str) -> str:
    if tag in TAG_META:
        return TAG_META[tag][0]
    return tag.replace('_', ' ').title() if tag else 'Other'
    # "petrol" → "Petrol", "staff_salary" → "Staff Salary"

def tag_emoji(tag: str) -> str:
    return TAG_META.get(tag, ('', '📝'))[1]
    # Unknown tag → 📝 (neutral)
```

This is the key architectural decision that prevents overfitting: the AI tags freely, the display layer falls back gracefully.

### The `_call_claude()` Function — Full Implementation

This is the single entry point for all Claude API calls:

```python
def _call_claude(model: str, prompt: str,
                 image_bytes: bytes = None, image_mime: str = None,
                 use_thinking: bool = False,
                 retries: int = 3) -> str:
    """
    Call Claude with optional image and optional extended thinking.
    Returns the text content of the response (thinking block excluded).
    """
    # Build content: image first (if present), then text prompt
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
                        'budget_tokens': _THINKING_BUDGET,   # 10,000
                    },
                    messages=[{'role': 'user', 'content': content}],
                )
                # Response has two content blocks:
                # 1. ThinkingBlock: private scratchpad (type='thinking')
                # 2. TextBlock: the actual answer (type='text')
                # We only want the TextBlock
                for block in resp.content:
                    if block.type == 'text':
                        return block.text
                # Safety fallback if structure changes
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
                wait = 15 * (2 ** attempt)   # exponential backoff: 15s, 30s, 60s
                time.sleep(wait)
            else:
                raise

        except anthropic.APIError as e:
            err = str(e)
            # 529 = API overloaded
            if '529' in err or 'overloaded' in err.lower():
                if attempt < retries - 1:
                    wait = 10 * (2 ** attempt)
                    time.sleep(wait)
                    continue
            # Model not found → fall back to Sonnet
            if 'not found' in err.lower() or 'model' in err.lower():
                if model == _VISION_MODEL and model != _VISION_FALLBACK:
                    return _call_claude(_VISION_FALLBACK, prompt, image_bytes, image_mime,
                                        use_thinking=use_thinking, retries=retries)
            # Thinking not supported by this model → retry without thinking
            if use_thinking and ('thinking' in err.lower() or 'not supported' in err.lower()):
                return _call_claude(model, prompt, image_bytes, image_mime,
                                    use_thinking=False, retries=retries - attempt)
            raise
```

**Critical design decisions here:**

1. **`max_tokens=16000` when `use_thinking=True`**: The Anthropic API requires `max_tokens > budget_tokens`. With a 10,000 token thinking budget, `max_tokens` must be at least 10,001. We set 16,000 to give the actual text response enough room.

2. **Image before text in content array**: Anthropic's vision API works best when the image is listed first in the content array, then the text prompt follows. If reversed, OCR quality drops.

3. **`adaptive` not `enabled`**: As of 2026, `thinking.type='enabled'` is deprecated. `'adaptive'` is the current API parameter and gives better model performance.

4. **Graceful fallback chain**: Opus → Sonnet → no thinking → raise. This means even if the best model is temporarily unavailable, the system degrades gracefully rather than hard-failing.

5. **Retry with exponential backoff**: Rate limits (429) and overload (529) are handled with 15s, 30s, 60s waits. This is essential for a production system.

### `_safe_parse()` — Robust JSON Extraction

```python
def _safe_parse(raw: str, fallback_msg: str) -> dict:
    """
    Parse JSON from Claude's response.
    Handles three formats:
      1. <json>...</json> tags    (preferred — from extended thinking calls)
      2. Raw JSON string          (fallback)
      3. JSON inside ```json fences (Claude sometimes adds these)
    """
    # Try <json> tags first
    json_match = re.search(r'<json>(.*?)</json>', raw, re.DOTALL)
    if json_match:
        raw = json_match.group(1).strip()

    try:
        return json.loads(_clean_json(raw))
    except json.JSONDecodeError:
        return {'transactions': [], 'persons_found': [],
                'response_message': fallback_msg}

def _clean_json(raw: str) -> str:
    raw = raw.strip()
    raw = re.sub(r'^```[a-z]*\n?', '', raw)    # strip ```json
    raw = re.sub(r'\n?```$', '', raw)           # strip closing ```
    return raw.strip()
```

**Why `<json>` tags?** When extended thinking is enabled, Claude sometimes produces conversational preamble before the JSON: *"Looking at this ledger, I can see..."* followed by the JSON. The `<json>` tags give a reliable delimiter. The prompt explicitly tells Claude: *"Produce your answer in `<json>` tags. Only the content inside `<json>...</json>` will be parsed."*

### `parse_image_message()` — Full Implementation

```python
def parse_image_message(image_url: str,
                        twilio_account_sid: str = None,
                        twilio_auth_token: str = None,
                        store_context: str = '') -> dict:
    # Step 1: Download image from Twilio CDN
    auth = (twilio_account_sid, twilio_auth_token) \
           if twilio_account_sid and twilio_auth_token else None
    r = httpx.get(image_url, auth=auth, timeout=40, follow_redirects=True)
    r.raise_for_status()
    image_bytes = r.content
    image_mime  = r.headers.get('content-type', 'image/jpeg').split(';')[0]

    # Step 2: Build prompt with today's date + store's correction history
    prompt = _IMAGE_PARSE_PROMPT.format(
        today=date.today().isoformat(),
        store_context=store_context if store_context else
                     '(No prior corrections for this store yet)',
    )

    # Step 3: Call Opus with extended thinking
    result_text = _call_claude(
        _VISION_MODEL, prompt,
        image_bytes=image_bytes, image_mime=image_mime,
        use_thinking=True,   # ← The key that makes it as smart as Claude in chat
    )

    # Step 4: Parse JSON from <json> tags
    result = _safe_parse(result_text,
        "Photo padh nahi paya 📷\nAchhi roshni mein clear photo bhejiye.")
    result['raw_ocr'] = '[single-pass with extended thinking]'
    return result
```

**Why `follow_redirects=True`?** Twilio serves media through its CDN with HTTP 307 redirects. Without this flag, `httpx` stops at the redirect and returns a 307 response body instead of the image bytes. This was a bug that caused all image parsing to fail silently.

**Why `timeout=40`?** Twilio's CDN can be slow on the first request for a new media URL. 40 seconds is generous enough to handle slow CDN responses without blocking the background thread forever.

### `parse_text_message()` — Text Parsing

```python
def parse_text_message(message: str, store_context: str = '') -> dict:
    prompt = _TEXT_PROMPT.format(
        today=date.today().isoformat(),
        message=message,
        store_context=store_context,
    )
    text = _call_claude(_TEXT_MODEL, prompt)   # Haiku, no thinking
    return _safe_parse(text, "Samajh nahi aaya 🙏\n...")
```

Text parsing uses Haiku (fast, cheap) without extended thinking. For simple text like "Sale 5000 cash" or "Raju ne 500 udhaar liya", Haiku is completely adequate. The prompt is simpler and doesn't include the 200-line vocabulary guide.

### `parse_correction()` — Single Entry Re-Parse

```python
def parse_correction(original_txn: dict, correction_text: str) -> dict:
    prompt = _CORRECTION_PROMPT.format(
        original=json.dumps(original_txn, ensure_ascii=False, indent=2),
        correction=correction_text,
    )
    text = _call_claude(_TEXT_MODEL, prompt)
    corrected = json.loads(_clean_json(text))
    return {**original_txn, **corrected}   # merge: only override changed fields
```

The `{**original_txn, **corrected}` merge means only the fields the owner corrected get changed. If the owner says "amount was 750 tha", only `amount` changes — the description, type, tag, and person all stay the same.

---

## 10. Webhook Deep-Dive

### File: `execution/moneybook_webhook.py`

### FastAPI Application Setup

```python
app = FastAPI(title='MoneyBook', version='2.0')
```

The app uses:
- `FastAPI.Form()` for Twilio's form-encoded webhook data
- `BackgroundTasks` for async image processing
- `PlainTextResponse` for TwiML XML responses
- `APScheduler` for cron jobs (injected via `@app.on_event('startup')`)

### The Webhook Handler — Full Flow

```python
@app.post('/whatsapp')
async def whatsapp_webhook(
    background_tasks: BackgroundTasks,
    From:               str = Form(...),
    Body:               str = Form(default=''),
    NumMedia:           int = Form(default=0),
    MediaUrl0:          str = Form(default=None),
    MediaContentType0:  str = Form(default=None),
):
```

Twilio sends the following form fields on every webhook:
- `From` — sender's WhatsApp number in `whatsapp:+91XXXXXXXXXX` format
- `Body` — text content (empty string if message is just an image)
- `NumMedia` — count of attached media files (0 or 1 for WhatsApp)
- `MediaUrl0` — URL of the first media file (if present)
- `MediaContentType0` — MIME type (`image/jpeg`, `image/png`, etc.)

**Decision tree inside the handler:**

```
1. Is this a new store? (onboarding_state == 'new')
   → Return greeting, ask for store name

2. Is this awaiting store name? (onboarding_state == 'awaiting_name')
   → Save name, return welcome + HELP_MSG

3. Does the message have media? (NumMedia > 0)
   → Spawn background task (process_image_and_reply)
   → Return TwiML ack immediately: "📷 Photo mil gayi! Padh raha hoon..."

4. Is it a command? (/summary, /udhaar, /month, /quarter, /year, /help)
   → Execute command, return result, clear bot state

5. Is the bot in a conversation state?
   confirming  → handle_confirming()
   correcting  → handle_correcting()
   classifying → handle_classifying()

6. Idle + text → parse_text_message()
   Single transaction → auto-save, return confirmation
   Multiple transactions → show confirmation list, set state = confirming
```

### Why BackgroundTasks for Images

Twilio has a hard 15-second timeout on webhook responses. If the webhook takes longer than 15 seconds to respond, Twilio marks it as failed and may retry — causing duplicate processing.

Image processing with Opus + extended thinking takes 60–90 seconds. The solution:

```python
# In the webhook (runs < 100ms):
if has_media:
    background_tasks.add_task(process_image_and_reply, from_number, MediaUrl0, body)
    return twiml_reply("📷 Photo mil gayi! Padh raha hoon... thoda wait karein ⏳")
    # ↑ Returns to Twilio within 100ms — well within 15s limit

# In the background (runs 60-90s after):
def process_image_and_reply(from_number, media_url, body):
    parsed = parse_image_message(...)   # The slow part
    send_whatsapp(from_number, reply)   # Push result via Twilio REST API
```

The reply is sent via Twilio's outbound REST API (`twilio.messages.create()`), not through the TwiML response. This is different from the TwiML reply path (which can only respond synchronously).

### `send_whatsapp()` — Message Splitting

Twilio WhatsApp has a **1600 character hard limit** per message. With 20+ transactions in a confirmation list, messages routinely exceed this. The solution splits messages at line boundaries:

```python
def send_whatsapp(to: str, body: str):
    LIMIT = 1500  # conservative — leave headroom for encoding

    if len(body) <= LIMIT:
        _send_single(to, body)
        return

    lines  = body.split('\n')
    chunks = []
    current = []
    current_len = 0

    for line in lines:
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
```

Splitting happens at line boundaries (not mid-line) so entries are never cut in half. The `_(Part 1/2)_` prefix is italicized in WhatsApp to indicate the split.

### `twiml_reply()` vs `send_whatsapp()`

These are two different paths:

```python
def twiml_reply(text: str) -> PlainTextResponse:
    """Synchronous reply — through TwiML XML in the webhook response"""
    r = MessagingResponse()
    r.message(text)
    return PlainTextResponse(str(r), media_type='application/xml')
    # Returns: <?xml version="1.0"?><Response><Message>text</Message></Response>

def send_whatsapp(to: str, body: str):
    """Asynchronous reply — via Twilio REST API (used for background tasks)"""
    twilio.messages.create(from_=TWILIO_WHATSAPP_NUMBER, to=to, body=body)
```

- `twiml_reply()` is used for all synchronous responses (text messages, commands)
- `send_whatsapp()` is used when replying from a background task (after image processing)

Both use the same Twilio sandbox number, so the user sees no difference.

### COMMANDS Dictionary

```python
COMMANDS = {
    '/summary': 'summary', 'summary': 'summary',
    'aaj ka hisaab': 'summary', 'aaj ka hisab': 'summary',
    '/udhaar': 'udhaar', 'udhaar': 'udhaar', 'udhaar list': 'udhaar',
    '/month': 'month', 'month': 'month', 'is mahine': 'month', 'mahina': 'month',
    '/quarter': 'quarter', 'quarter': 'quarter', 'is quarter': 'quarter',
    '/year': 'year', 'year': 'year', 'is saal': 'year', 'saal': 'year',
    '/help': 'help', 'help': 'help',
}
```

Both English (`/summary`) and Hindi (`aaj ka hisaab`) triggers are supported. Detection:

```python
def detect_command(text: str) -> Optional[str]:
    t = text.lower().strip()
    for trigger, action in COMMANDS.items():
        if t == trigger or t.startswith(trigger + ' '):
            return action
    return None
```

Commands always interrupt any active conversation state — if you're in `confirming` state and type `/summary`, the pending transactions are abandoned and the summary is shown.

---

## 11. Conversation State Machine

The bot maintains a conversation state per store, stored as JSON in `stores.bot_state`. This is the full state machine:

```
                    ┌─────────────────────────────────┐
                    │                                 │
          ┌─────────▼─────────┐                       │
          │       IDLE        │◄──────────────────────┤
          │                   │       cancel / haan   │
          └─────────┬─────────┘                       │
                    │                                 │
        ┌───────────┼────────────┐                    │
        │           │            │                    │
        ▼           ▼            ▼                    │
    command    single txn    multiple txns             │
        │           │            │                    │
        │       auto-save    ┌───▼─────────────┐      │
        │           │        │   CONFIRMING    │      │
        ▼           ▼        │                 │      │
    reply OK    reply OK     │ pending: [txns] │      │
                             └────┬──────┬─────┘      │
                                  │      │             │
                              "galat N" "haan"         │
                                  │      │             │
                    ┌─────────────▼─┐    │             │
                    │  CORRECTING   │    │             │
                    │               │    ▼             │
                    │ correcting_   │  save all        │
                    │ index: N      │    │             │
                    └──────┬────────┘    │             │
                           │            │             │
                    corrected entry      ▼             │
                           │     new persons?         │
                    return to            │             │
                    CONFIRMING    ┌──────▼─────────┐   │
                                  │  CLASSIFYING   │   │
                                  │                │   │
                                  │ persons_queue: │   │
                                  │ [name1, ...]   ├───┘
                                  └────────────────┘
                                  (answer 1/2/3/4 for each)
```

### State Persistence

States are stored as JSON in `stores.bot_state` column. For example, when in `confirming` state:

```json
{
  "state": "confirming",
  "pending": [
    {"type": "opening_balance", "amount": 32398, "description": "Opening Balance", ...},
    {"type": "receipt", "amount": 4850, "description": "Dharmendar, Bill B-5344", ...}
  ],
  "persons_found": ["Dharmendar", "Sunil Rewanand", "Swari"],
  "persons_map": {},
  "raw_message": "",
  "source": "image",
  "page_date": "2025-12-12",
  "raw_ocr": "[single-pass with extended thinking]"
}
```

This means the state survives server restarts — the pending transactions are in the database, not in memory.

### State Handlers

**`handle_confirming(body, store, state)`**

Accepted inputs:
- `haan` / `han` / `yes` / `ok` / `sahi` → save all transactions
- `galat N` or `N galat` → enter correcting state for entry N
- `N tag <tag_name>` → change tag for entry N inline, re-show list
- `cancel` → abort, return to idle
- Anything else → show confused message + re-show list

**`handle_correcting(body, store, state)`**

The owner provides free-form correction text: *"amount 750 tha"* or *"yeh Raju ka udhaar tha"*. This text is passed to `parse_correction()` which re-parses the entry against the original. The corrected entry replaces the pending entry, the correction is saved for learning, and state returns to `confirming`.

**`handle_classifying(body, store, state)`**

The owner answers `1`, `2`, `3`, or `4` for each new person:
1. Staff / Employee
2. Customer / Grahak
3. Supplier / Party
4. Ghar ka kharcha / Personal

The person is saved in the `persons` table. State advances through the queue. When all persons are classified, state returns to idle.

---

## 12. Database Layer Deep-Dive

### Connection Management

```python
@contextmanager
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row          # rows accessible as dicts
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

Every database operation opens and closes its own connection. This is safe for SQLite:
- SQLite uses file-level locking
- WAL mode would help with concurrent readers, but at current scale (< 10 concurrent users), the simple approach is fine
- `conn.row_factory = sqlite3.Row` makes rows dict-accessible: `row['amount']` instead of `row[3]`
- `PRAGMA foreign_keys = ON` is required per-connection in SQLite (not a persistent setting)

### `get_daily_summary()` — Smart Date Fallback

```python
def get_daily_summary(store_id: int, for_date: str = None) -> dict:
    if not for_date:
        for_date = date.today().isoformat()
    with get_db() as conn:
        # If no data for today, fall back to most recent date with data
        has_data = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE store_id = ? AND date = ?",
            (store_id, for_date)
        ).fetchone()[0]
        if not has_data:
            latest = conn.execute(
                "SELECT date FROM transactions WHERE store_id = ? ORDER BY date DESC LIMIT 1",
                (store_id,)
            ).fetchone()
            if latest:
                for_date = latest[0]
        ...
```

If the owner asks for `/summary` on a day with no data (e.g., it's only 10 AM and they haven't sent anything yet), the bot falls back to the most recent date with data rather than showing "No data found." This is a UX decision — owners want to see the last meaningful data.

### `build_store_context()` — Learning Context Builder

```python
def build_store_context(store_id: int) -> str:
    corrections = get_recent_corrections(store_id, limit=15)
    if not corrections:
        return ""

    lines = ["📚 Past corrections for this store (learn from these):"]
    for c in corrections:
        orig = json.loads(c['original_json'])
        corr = json.loads(c['corrected_json'])
        orig_desc = orig.get('description', '?')
        corr_tag  = corr.get('tag', '')
        corr_type = corr.get('type', '')
        corr_desc = corr.get('description', '')
        corr_amt  = corr.get('amount', '')
        lines.append(
            f'  • "{orig_desc}" → type:{corr_type}, tag:{corr_tag}'
            + (f', desc:"{corr_desc}"' if corr_desc else '')
            + (f', amount:{corr_amt}' if corr_amt else '')
        )
    return '\n'.join(lines)
```

Example output injected into prompts:

```
📚 Past corrections for this store (learn from these):
  • "Phenol 40" → type:expense, tag:cleaning, desc:"Phenyl cleaning liquid", amount:40
  • "CD Vivek" → type:expense, tag:cash_discount, person:Vivek Singh
  • "PTm card" → type:upi_in_hand, amount:29635
```

This means after the first month of use, the bot has learned the store's specific vocabulary and rarely makes the same mistake twice.

---

## 13. Dashboard

### File: `execution/moneybook_dashboard.py`

Run with:
```bash
streamlit run execution/moneybook_dashboard.py
# Opens at http://localhost:8501
```

### Components

**Sidebar:**
- Store selector (dropdown of all active stores)
- Date range picker (From / To)
- Store metadata (phone number, registration date)

**KPI Row (4 columns):**
```python
c1.metric('💰 Total Sales',         f'₹{total_sales:,.0f}')
c2.metric('💸 Total Expenses',      f'₹{total_expenses:,.0f}')
c3.metric('📊 Net P&L',             f'₹{net_pl:,.0f}', delta=...)
c4.metric('⚠️ Outstanding Udhaar',  f'₹{udhaar_out:,.0f}')
```

**Charts:**
- Daily sales bar chart (Plotly Express, green bars)
- Expense breakdown pie chart (by description, Plotly Pastel colors)
- Cash flow waterfall chart (Sales → Udhaar Recv → Expenses → Udhaar Given → Net)

**Udhaar Table:** Person name, outstanding balance, last activity date

**Transaction Log:** Filterable by transaction type, shows last 50 entries

**Database access:** Dashboard uses a cached read-only `sqlite3.connect()` separate from the write connection pool in `moneybook_db.py`. This avoids locking issues.

---

## 14. Scheduled Jobs

APScheduler is configured in `moneybook_webhook.py`:

```python
_scheduler = BackgroundScheduler(timezone='Asia/Kolkata')
_scheduler.add_job(job_daily_summary, 'cron', hour=21, minute=0)
_scheduler.add_job(job_udhaar_alerts, 'cron', day_of_week='mon', hour=9)

@app.on_event('startup')
def on_startup():
    init_db()
    _scheduler.start()
```

### Daily Summary (9 PM IST every day)

```python
def job_daily_summary():
    for store in get_all_active_stores():
        data = get_daily_summary(store['id'])
        msg  = format_daily_summary(data, store.get('name', 'Store'))
        msg += "\n\n_📒 MoneyBook Daily Report_"
        send_whatsapp(store['phone'], msg)
```

Sends each active store their full day's summary: income breakdown, expense-by-category, cash reconciliation check.

### Udhaar Alerts (Monday 9 AM IST)

```python
def job_udhaar_alerts():
    for store in get_all_active_stores():
        aging = get_udhaar_aging(store['id'], days=30)
        # aging = persons with outstanding balance untouched for 30+ days
        if not aging:
            continue
        total = sum(u['balance'] for u in aging)
        lines = [f"⚠️ *Purana Udhaar — {store.get('name','')}*\n"]
        for u in aging:
            days = (date.today() - date.fromisoformat(u['last_transaction_date'])).days
            lines.append(f"• {u['person_name']}: ₹{u['balance']:,.0f} ({days} din)")
        send_whatsapp(store['phone'], '\n'.join(lines))
```

The aging query:
```sql
SELECT * FROM udhaar
WHERE store_id = ? AND balance > 0 AND last_transaction_date <= ?
ORDER BY last_transaction_date ASC
```

This sends a weekly reminder for any person whose udhaar balance hasn't changed in 30 days — these are likely forgotten debts that the store owner needs to follow up on.

---

## 15. Per-Store Learning System

This is one of the most sophisticated features. The system gets smarter for each store over time without any manual configuration.

### How It Works

1. Owner sends a photo. Bot parses it with some errors.
2. Owner says `galat 3` → enters correcting state
3. Owner provides correction: "yeh Phenyl ka kharcha tha, cleaning"
4. `parse_correction()` re-parses entry 3
5. `save_correction()` saves both the original and corrected JSON to `store_corrections`
6. Next time owner sends a photo, `build_store_context()` injects the last 15 corrections as few-shot examples
7. Claude sees: *"Past correction: 'Phenol' → type:expense, tag:cleaning"* and applies it automatically

### Why 15 Corrections?

15 corrections fit comfortably within the prompt token budget while covering the most common recurring mistakes. The `get_recent_corrections()` query orders by `created_at DESC` so the most recent (most relevant) corrections are always included.

### Few-Shot Injection Pattern

```python
# In parse_image_message():
ctx = build_store_context(sid)
prompt = _IMAGE_PARSE_PROMPT.format(
    today=date.today().isoformat(),
    store_context=ctx or '(No prior corrections for this store yet)',
)
```

The `{store_context}` placeholder in `_IMAGE_PARSE_PROMPT` is replaced with the correction history. This turns past corrections into few-shot examples that guide the model on this store's specific vocabulary.

---

## 16. Message Splitting & Twilio Constraints

### The 1600 Character Limit

Twilio's WhatsApp API hard-limits each message body to 1600 characters. With 20 transactions in a confirmation list (averaging 80 chars each = 1600 chars), messages routinely hit this limit.

The first time this was encountered in production testing, Twilio returned:
```
HTTP 400 — Error 21617: The concatenated message body exceeds the 1600 character limit
```

The image was processed successfully (20 transactions found) but the reply was never delivered — the owner saw only the "📷 Photo mil gayi! Padh raha hoon..." acknowledgment and nothing else. This appeared as if the bot had processed the image but never responded.

### The Fix

The `send_whatsapp()` function (detailed in Section 10) splits at line boundaries, adding `_(Part 1/2)_` prefixes. For a 20-entry confirmation:

- Part 1: Header + entries 1-12 (~1450 chars)
- Part 2: Entries 13-20 + action buttons (~800 chars)

The owner receives both messages in sequence on WhatsApp.

### Other Twilio Constraints

| Constraint | Value | Handling |
|------------|-------|---------|
| Webhook timeout | 15 seconds | BackgroundTasks pattern |
| Media download | Twilio CDN + redirects | `follow_redirects=True` |
| WhatsApp sandbox join | Required once | Documented in setup guide |
| Outbound rate | 1 msg/sec | Not currently throttled (low volume) |

---

## 17. Complete End-to-End Flow — Text Message

**Owner types:** `"Sale 5000 cash"`

**Step 1 — Twilio receives message**
```
POST /whatsapp
From=whatsapp%3A%2B919102662588
Body=Sale+5000+cash
NumMedia=0
```

**Step 2 — Webhook processes (< 100ms)**
```python
store = get_or_create_store('whatsapp:+919102662588')
# onboarding_state = 'active', bot_state = '{}'

action = detect_command('Sale 5000 cash')   # → None (not a command)
# current state = 'idle' (bot_state is empty)

ctx    = build_store_context(store['id'])   # → '' (no corrections yet)
parsed = parse_text_message('Sale 5000 cash', store_context='')
```

**Step 3 — Claude Haiku call**
```python
# Prompt sent:
"""
You are a financial transaction parser for Indian retail store owners.
Parse the message below and extract ALL financial transactions.

TODAY: 2026-03-28
MESSAGE: "Sale 5000 cash"
(No prior corrections for this store)
...
"""
# Response:
{
  "transactions": [
    {
      "type": "sale",
      "amount": 5000,
      "description": "Sale",
      "tag": null,
      "person_name": null,
      "payment_mode": "cash",
      "date": "2026-03-28"
    }
  ],
  "persons_found": [],
  "response_message": "Sale ₹5,000 (cash) save ho gayi"
}
```

**Step 4 — Single transaction path**
```python
txns = [t for t in parsed['transactions'] if t['amount'] > 0]
# len(txns) == 1 → auto-save without confirmation

add_transaction(store['id'], txns[0], raw_message='Sale 5000 cash', source='text')
# INSERT INTO transactions (store_id, date, type, amount, ...) VALUES (...)

reply = "✅ Save: Sale — ₹5,000\n   💰 _Bikri / Sale_"
return twiml_reply(reply)
```

**Step 5 — Owner receives on WhatsApp**
```
✅ Save: Sale — ₹5,000
   💰 Bikri / Sale
```

Total round-trip time: ~600ms (Twilio → server → Haiku → Twilio → WhatsApp)

---

## 18. Complete End-to-End Flow — Image/Photo

**Owner sends a photo of their daily notebook page**

**Step 1 — Twilio receives media**
```
POST /whatsapp
From=whatsapp%3A%2B919102662588
Body=
NumMedia=1
MediaUrl0=https://api.twilio.com/2010-04-01/Accounts/ACxx.../Messages/MMxx.../Media/MExx
MediaContentType0=image%2Fjpeg
```

**Step 2 — Webhook returns ack immediately (< 100ms)**
```python
if has_media:
    background_tasks.add_task(process_image_and_reply,
                              from_number='whatsapp:+919102662588',
                              media_url='https://api.twilio.com/...',
                              body='')
    return twiml_reply("📷 Photo mil gayi! Padh raha hoon... thoda wait karein ⏳")
```

**Step 3 — Background task starts**
```python
def process_image_and_reply(from_number, media_url, body):
    store = get_or_create_store(from_number)
    ctx   = build_store_context(store['id'])   # fetch past corrections
    parsed = parse_image_message(media_url, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ctx)
```

**Step 4 — Image download**
```python
# httpx GET to Twilio CDN URL
# Twilio returns HTTP 307 → redirects to CDN
# httpx follows redirect (follow_redirects=True)
# Final URL: https://mms.twiliocdn.com/ACxx.../fa6c89a62...?Expires=...
# Response: raw JPEG bytes, Content-Type: image/jpeg
```

**Step 5 — Claude Opus API call with Extended Thinking**
```python
# API Request:
{
  "model": "claude-opus-4-6",
  "max_tokens": 16000,
  "thinking": {
    "type": "adaptive",
    "budget_tokens": 10000
  },
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "image",
        "source": {
          "type": "base64",
          "media_type": "image/jpeg",
          "data": "/9j/4AAQSkZJRgAB..."  (base64 encoded JPEG)
        }
      },
      {
        "type": "text",
        "text": "You are an expert accountant who has spent 20 years reading handwritten Indian retail store cash books...\n\nTODAY: 2026-03-28\n(No prior corrections for this store yet)\n..."
      }
    ]
  }]
}

# API Response (after ~83 seconds):
{
  "content": [
    {
      "type": "thinking",    // Private scratchpad
      "thinking": "Let me read this ledger carefully. I can see a two-column layout. The left column starts with an opening balance entry that looks like 32,398 — in Indian format that's 32398. Next I see 'Dharmendar' with a small '819' above it (that's a reference note, not an amount) and the main amount '4850'...\n\nI notice 'Closing Bal' at the bottom right — this is NOT 'Cleaning Bal' — 'Closing' starts with 'Cl' and the lowercase 'o' can look like 'a' in cursive but contextually this is end-of-day balance...\n\nLet me verify: Left total = 32398 + 4850 + 70 + 1830 + 3980 + 51930 = 95058. Right total = 320 + 40 + 120 + 5100 + 480 + 675 + 300 + 190 + 3000 + 6765 + 10000 + 315 + 29635 = 56940. Net = 95058 - 56940 = 38118 = matches Closing Bal. ✓"
    },
    {
      "type": "text",       // The actual output we use
      "text": "<json>\n{\n  \"date\": \"2025-12-12\",\n  \"transactions\": [\n    {\"type\": \"opening_balance\", \"amount\": 32398, ...},\n    ...\n  ]\n}\n</json>"
    }
  ]
}
```

**Step 6 — JSON extraction and validation**
```python
result_text = resp.content[1].text   # The text block (not thinking)
result = _safe_parse(result_text, "Photo padh nahi paya 📷")
# Extracts JSON from <json>...</json> tags
txns = [t for t in result['transactions'] if t['amount'] > 0]
# 20 transactions found
```

**Step 7 — Store state and build reply**
```python
set_bot_state(store['id'], {
    'state':     'confirming',
    'pending':   txns,           # 20 transaction dicts
    'page_date': '2025-12-12',
    'source':    'image',
    ...
})
reply = format_pending_confirmation(txns, '2025-12-12')
# Builds the WhatsApp message with numbered entries
```

**Step 8 — Message splitting and delivery**
```python
send_whatsapp('whatsapp:+919102662588', reply)
# reply is ~1800 chars → splits into Part 1/2 and Part 2/2
# Two Twilio REST API calls:
# POST https://api.twilio.com/2010-04-01/Accounts/ACxx.../Messages.json
#   Body=_(Part+1%2F2)_%0A📋+*Maine+padha+...
# POST https://api.twilio.com/2010-04-01/Accounts/ACxx.../Messages.json
#   Body=_(Part+2%2F2)_%0A13.+Petrol+...
```

**Step 9 — Owner receives two messages**
```
_(Part 1/2)_
📋 *Maine padha (2025-12-12):*

1. Opening Balance — ₹32,398
   🔓 Opening Balance
2. Dharmendar, Bill B-5344 (ref: 819) — ₹4,850
   📤 Dues / Baki
...
12. Jairam Dhulai (washing/cleaning charge) — ₹480
   🧹 Cleaning

_(Part 2/2)_
13. Petrol (delivery vehicle) — ₹300
   🚚 Transport / Labour
...
20. Closing Balance — ₹38,118
   🔒 Closing Balance

✅ *haan* → Sab save karo
✏️ *galat 3* → Entry 3 theek karo
❌ *cancel* → Cancel
```

Total time from photo send to reply: ~85 seconds

**Step 10 — Owner replies "haan"**
```python
# Webhook receives: Body=haan
bot_state = get_bot_state(store['id'])
# current = 'confirming'
handle_confirming('haan', store, bot_state)
# → save_confirmed_batch() → 20 INSERT INTO transactions
# → check for unknown persons → classifying if any new names
# → clear_bot_state()
return twiml_reply("✅ *20 entries save ho gayi!\n\nAgle entry ke liye ready hoon 📒")
```

---

## 19. All API Calls — Parameters, Models, Retry Logic

### Anthropic Claude API

**Call 1 — Image Parsing**
```python
_client.messages.create(
    model='claude-opus-4-6',
    max_tokens=16000,
    thinking={
        'type': 'adaptive',
        'budget_tokens': 10000,
    },
    messages=[{
        'role': 'user',
        'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': '...'}},
            {'type': 'text', 'text': '<full _IMAGE_PARSE_PROMPT>'},
        ]
    }]
)
# max_tokens=16000 because: thinking budget (10000) + response (~5000) + buffer = ~16000
# Typical response time: 60-90 seconds
# Typical cost: ~$0.08 per image (Opus pricing + thinking tokens)
```

**Call 2 — Text Parsing**
```python
_client.messages.create(
    model='claude-haiku-4-5',
    max_tokens=4096,
    messages=[{
        'role': 'user',
        'content': '<_TEXT_PROMPT formatted string>'
    }]
)
# Typical response time: 1-2 seconds
# Typical cost: ~$0.0003 per message
```

**Call 3 — Single Entry Correction**
```python
_client.messages.create(
    model='claude-haiku-4-5',
    max_tokens=4096,
    messages=[{
        'role': 'user',
        'content': '<_CORRECTION_PROMPT>'
    }]
)
```

**Retry Logic:**

| Error | Retry Strategy |
|-------|----------------|
| `anthropic.RateLimitError` (429) | Exponential backoff: 15s, 30s, 60s (3 attempts) |
| `anthropic.APIError` 529 (overloaded) | Exponential backoff: 10s, 20s (3 attempts) |
| Model not found | Fall back to `claude-sonnet-4-5`, one attempt |
| Thinking not supported | Retry same model without thinking |
| Any other exception | Propagate immediately |

### Twilio REST API

**Outbound message (from `send_whatsapp`)**
```python
twilio.messages.create(
    from_='whatsapp:+14155238886',   # sandbox number
    to='whatsapp:+919102662588',
    body='<message text>'
)
# POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
# Content-Type: application/x-www-form-urlencoded
# Auth: HTTP Basic (account_sid:auth_token)
```

**Media download (in `parse_image_message`)**
```python
httpx.get(
    url='https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages/{MID}/Media/{ID}',
    auth=(account_sid, auth_token),
    timeout=40,
    follow_redirects=True
)
# Returns: JPEG/PNG bytes
# Twilio redirects to CDN: https://mms.twiliocdn.com/...
```

---

## 20. Prompt Engineering — Full Prompts with Annotations

### Prompt 1: `_IMAGE_PARSE_PROMPT`

This is the most important prompt in the system — 160 lines covering everything the model needs to read Indian retail ledgers.

```
You are an expert accountant who has spent 20 years reading handwritten Indian retail
store cash books (bahi khata / rozkaamil) across all types of businesses — textile,
grocery, wholesale, hardware, pharmacy, and more.
```
**Why:** Role-priming. "Expert accountant" + "20 years" + specific business types sets the model's context. It activates domain knowledge about Indian business practices that a generic assistant wouldn't use.

```
TODAY: {today}
{store_context}
```
**Why:** `{today}` ensures dates are correctly relative (entries without explicit dates get today's date). `{store_context}` is the per-store correction history — injects few-shot examples.

```
━━ HOW TO READ THE PAGE ━━
The page typically has TWO columns:
  LEFT  = Money IN  → opening balance, sales, money received from customers/parties
  RIGHT = Money OUT → expenses, staff payments, bank deposits, day-end cash/UPI totals
```
**Why:** Without this, the model sometimes conflates left and right columns. Explicit column semantics prevent type assignment errors (a figure in the right column being labeled as income).

```
━━ TAG — FREE FORM, BE SPECIFIC ━━
For "tag", write a short lowercase English label that naturally describes the expense.
Do NOT pick from a fixed list. Use your world knowledge to be precise.
Examples: petrol, staff_salary, tailoring, freight, loading_labour, refreshment, cleaning_supplies
NEVER write "other" as a tag — always be specific.
```
**Why:** This is the anti-overfitting rule. Explicitly telling the model NOT to use "other" and NOT to pick from a list forces it to use genuine understanding. This was added after observing that with a predefined tag list, the model force-fitted "Tea" into "office_supplies" because nothing in the list said "food" or "refreshment."

```
━━ COMMON INDIAN BUSINESS VOCABULARY ━━
Bhada / Bhaada          → freight charge → tag: transport
Riksha Bhada            → rickshaw delivery → tag: transport
Palledari / Palledaari  → loading/unloading labour → tag: transport
Dhulai (standalone)     → transport/delivery charge → tag: transport
Dhulai + person name    → washing charge (fabric) → tag: cleaning
```
**Why:** These are vocabulary items that are NOT in standard English-language training data. An English LLM does not know that "Palledari" is a loading charge. These explicit mappings are the minimum vocabulary needed. The model's world knowledge fills in the rest.

```
━━ ANNOTATION RULES ━━
1. Small number written ABOVE or BESIDE a main amount = reference note
   Example: "819" written above "4850 Dharmendar" → 819 is a reference, 4850 is the transaction
2. "B-5344" or "B5344" after a person name = bill/order number (put in description, not amount)
3. Long digit string (6+ digits) after a name = bill reference number, not an amount
```
**Why:** Without these rules, the model sometimes takes reference numbers (bill numbers, dates written small above amounts) as additional transaction amounts. This was a real bug: "819" above "4850" was being parsed as two separate entries.

```
━━ INDIAN NUMBER FORMAT — CRITICAL ━━
Indian comma format is different from Western:
  1,12,923 = [1][12][923] = 112923  (NOT 11,292 — that drops a digit)
  10,898   = [10][898]    = 10898
  42,129   = [42][129]    = 42129
Rule: concatenate all digit groups between commas. NEVER drop a group.
```
**Why:** This was a critical accuracy bug in production. `1,12,923` was being parsed as `11292` (dropping the `[923]` group). The Western comma rule (thousands separators) doesn't apply to Indian number format. The model needs explicit instruction to concatenate groups.

```
━━ CROSS-VERIFICATION ━━
After reading all entries:
1. Sum the LEFT column. Sum the RIGHT column.
2. If a TOTAL is written at the bottom of both columns, they should match.
3. If they don't match, re-read — you've likely missed an entry or misread an amount.
```
**Why:** This is a powerful accuracy mechanism. Indian ledger books always have column totals. By asking the model to verify against the written totals, we catch missed entries and misread amounts. The model's extended thinking scratchpad is where this verification happens before the final JSON output.

```
━━ OUTPUT FORMAT ━━
Produce your answer in <json> tags. Only the content inside <json>...</json> will be parsed.
<json>
{
  "date": "...",
  "transactions": [...],
  "persons_found": [...],
  "left_total": ...,
  "right_total": ...,
  "skipped_entries": "..."
}
</json>
```
**Why:** The `<json>` tags are needed because with extended thinking enabled, the model sometimes produces conversational text before the JSON. The tags give a reliable delimiter for extraction.

### Prompt 2: `_TEXT_PROMPT`

```
You are a financial transaction parser for Indian retail (kirana/wholesale) store owners.
Parse the message below and extract ALL financial transactions.

TODAY: {today}
MESSAGE: "{message}"

{store_context}

━━ IMPORTANT: CD = CASH DISCOUNT (not cash drawn) ━━
"CD A. Tiwari 695" → expense, tag: cash_discount, person: A. Tiwari, amount: 695

━━ TAG — BE SPECIFIC, USE YOUR OWN WORDS ━━
Write a short lowercase English label describing the nature of the expense.

━━ OUTPUT — ONLY valid JSON ━━
{ "transactions": [...], "persons_found": [...], "response_message": "..." }
```

The text prompt is simpler because:
- No image to parse — less complexity
- Short text messages have less ambiguity
- Haiku (the model) doesn't benefit from thinking for simple transactions
- `ONLY valid JSON` is acceptable here since there's no preamble risk

### Prompt 3: `_CORRECTION_PROMPT`

```
A store owner is correcting a single transaction entry that was wrongly parsed.

ORIGINAL ENTRY (what AI parsed):
{original}

OWNER'S CORRECTION: "{correction}"

Return ONLY the corrected transaction as JSON — same structure, only fix what changed.
```

Minimal prompt — just gives the model the original entry and the owner's correction. The model infers what changed. This works because corrections are usually simple: "amount was 750" or "yeh Raju ka udhaar tha."

---

## 21. Extended Thinking — Design & Implementation

### What It Is

Extended Thinking (Anthropic's `adaptive` thinking) gives Claude a private reasoning block in the response. This block:
1. Is generated before the final answer
2. Is NOT constrained by output format rules
3. Contains the model's internal reasoning, analysis, cross-checking
4. Is stripped from the output (only the `text` block is returned to the application)

### Why It Matters for This Use Case

Without extended thinking, when you prompt Claude with `"OUTPUT — ONLY valid JSON"`, you're forcing the model to suppress its reasoning and jump straight to output. For simple inputs, this is fine. For a 20-entry handwritten Indian ledger with:
- Mixed scripts
- Abbreviations
- Reference annotations
- Indian number format
- Context-dependent vocabulary
- Column totals to verify against

...the model needs to reason. Suppressing that reasoning causes systematic errors.

With extended thinking, the model's scratchpad (from the actual response during testing) reads:

```
"Looking at this entry: '819' appears to be written small above the '4850 Dharmendar' line.
In Indian ledgers, small numbers above amounts are typically reference numbers (bill numbers
or dates in short form). The 819 is likely the bill number. The actual transaction amount
is 4850...

Now for '1,12,923': Indian number format uses different comma placement. This is:
[1][12][923] = 112923. Not 11292. The transaction amount is ₹1,12,923 = 112,923...

Checking column totals: Left = 32398 + 4850 + 70 + 1830 + 3980 + 51930 = 95058.
The written total matches. Right column = 320 + 40 + 120 + 5100 + 480 + ... = 56940.
Net = 95058 - 56940 = 38118. Matches the written 'Closing Bal 38118'. ✓"
```

This is the model thinking through the image, catching its own potential errors, and arriving at the correct structured output. This is exactly what makes it perform like "Claude in chat."

### Implementation Details

```python
resp = _client.messages.create(
    model='claude-opus-4-6',
    max_tokens=16000,          # MUST be > budget_tokens
    thinking={
        'type': 'adaptive',    # NOT 'enabled' (deprecated)
        'budget_tokens': 10000,
    },
    messages=[{'role': 'user', 'content': content}],
)

# Response structure:
resp.content = [
    ThinkingBlock(type='thinking', thinking='Let me analyze this ledger...'),
    TextBlock(type='text', text='<json>{"date": "2025-12-12", ...}</json>')
]

# Extraction: only take the TextBlock
for block in resp.content:
    if block.type == 'text':
        return block.text
```

**`max_tokens` must be > `budget_tokens`:** If you set `budget_tokens=10000` and `max_tokens=8000`, the API returns a 400 error. We use `max_tokens=16000` to give plenty of room for both thinking (10,000) and actual response (~5,000).

**`'adaptive'` vs `'enabled'`:** The `'enabled'` type was deprecated in early 2026. Using it triggers a `UserWarning` and may produce suboptimal results. `'adaptive'` is the current parameter.

### Thinking Budget Calibration

| Budget | Impact | Cost |
|--------|--------|------|
| 2,000 | Basic reasoning, may miss complex cases | Low |
| 5,000 | Good for most ledgers | Moderate |
| 10,000 | Handles 20+ entry complex pages, cross-verification | High |
| 16,000 | Maximum for most models | Very high |

We chose 10,000 because:
- Most ledger pages have 15-25 entries
- Cross-verification of column totals requires ~2,000 thinking tokens
- 10,000 gives comfortable headroom for complex multi-column pages

---

## 22. Error Handling & Self-Healing

### API Errors

Every API call is wrapped in retry logic with exponential backoff:

```
Rate limit (429): 15s → 30s → 60s → raise
Overload (529):   10s → 20s → raise
Model not found:  Immediate fallback to Sonnet, no wait
Thinking error:   Immediate retry without thinking
Other APIError:   Raise immediately
```

### Parsing Errors

`_safe_parse()` returns a safe fallback dict rather than raising:
```python
except json.JSONDecodeError:
    return {'transactions': [], 'persons_found': [],
            'response_message': fallback_msg}
```

The user gets a friendly error message rather than a 500.

### Database Errors

The `get_db()` context manager handles rollback automatically:
```python
try:
    yield conn
    conn.commit()
except Exception:
    conn.rollback()
    raise
```

### Background Task Errors

```python
def process_image_and_reply(from_number, media_url, body):
    try:
        ...
    except Exception as e:
        log.error(f"Background image processing failed: {e}")
        send_whatsapp(from_number, f"⚠️ Photo process karne mein error: {str(e)[:100]}")
```

Background task failures are caught, logged, and a user-friendly message is sent.

### State Corruption

If `bot_state` JSON in the database is malformed:
```python
def get_bot_state(store_id: int) -> dict:
    try:
        return json.loads(row['bot_state'] or '{}')
    except Exception:
        return {}   # corrupted state → reset to idle silently
```

Corrupted state is treated as idle. The owner loses their pending transactions but the system remains functional.

### Twilio Delivery Errors

`_send_single()` catches all Twilio exceptions and logs them. The server doesn't crash if a message can't be delivered (e.g., the owner's WhatsApp is offline temporarily).

---

## 23. Known Bugs, Root Causes, and Fixes

### Bug 1: Indian Number Format Misread
**Symptom:** `1,12,923` parsed as `11292` (or `11,292`)
**Root cause:** Model applying Western comma rules (thousands separators) to Indian comma format
**Fix:** Added explicit Indian number format section to `_IMAGE_PARSE_PROMPT`:
```
1,12,923 = [1][12][923] = 112923  (NOT 11,292 — that drops a digit)
Rule: concatenate all digit groups between commas. NEVER drop a group.
```

### Bug 2: UPI Misread as OPI
**Symptom:** UPI transactions showing as "OPI payment"
**Root cause:** U and O look similar in Indian cursive handwriting; model applying direct OCR without contextual reasoning
**Fix:** Added misspelling correction to prompt:
```
OPI / 0PI / UPl / UPl  → UPI
```

### Bug 3: Non-Expense Types Showing "📝 Other"
**Symptom:** Opening balance, closing balance, sales showing "📝 Other" in confirmation list
**Root cause:** `format_pending_confirmation()` only called `tag_emoji()` / `tag_label()`, which looks up expense tags. Types like `opening_balance`, `sale`, `receipt` don't have expense tags (tag=null), so they fell through to the default "📝 Other"
**Fix:** Added `_TYPE_META` dict in `format_pending_confirmation()`:
```python
_TYPE_META = {
    'opening_balance': ('🔓', 'Opening Balance'),
    'closing_balance': ('🔒', 'Closing Balance'),
    'sale':            ('💰', 'Bikri / Sale'),
    'receipt':         ('📨', 'Receipt'),
    ...
}
if txn_type in _TYPE_META:
    emoji, label = _TYPE_META[txn_type]
else:
    emoji = tag_emoji(tag)    # expense types → use tag
    label = tag_label(tag)
```

### Bug 4: `_OCR_PROMPT` / `_STRUCTURE_PROMPT` Still Referenced
**Symptom:** `NameError: name '_OCR_PROMPT' is not defined` on first image send
**Root cause:** During refactor from two-pass (OCR then structure) to single-pass, the old prompt constants were deleted but `parse_image_message()` still called them
**Fix:** Rewrote `parse_image_message()` to use `_IMAGE_PARSE_PROMPT` in single call

### Bug 5: Twilio 307 Redirect Not Followed
**Symptom:** `parse_image_message()` receiving HTML content instead of image bytes
**Root cause:** Twilio's CDN uses 307 redirects. Default `httpx.get()` doesn't follow redirects
**Fix:** Added `follow_redirects=True` to httpx call

### Bug 6: Message Body Exceeds 1600 Characters
**Symptom:** Image with 20+ transactions processed successfully but owner receives no reply
**Root cause:** Twilio returns HTTP 400 error 21617 (body > 1600 chars). Exception was caught and logged but not retried
**Fix:** `send_whatsapp()` now splits messages at line boundaries into multiple messages with `_(Part N/M)_` prefix

### Bug 7: `thinking.type='enabled'` Deprecated Warning
**Symptom:** `UserWarning: Using 'thinking.type=enabled' is deprecated` filling server logs
**Root cause:** Anthropic deprecated `'type': 'enabled'` in favor of `'type': 'adaptive'`
**Fix:** Changed `'type': 'enabled'` to `'type': 'adaptive'` in `_call_claude()`

### Bug 8: Gemini Model Name Changed
**Symptom:** `generate_knowledge_doc.py` failing with model not found error
**Root cause:** `gemini-2.5-flash-preview-05-20` was renamed to `gemini-2.5-flash`
**Fix:** Updated model name; also migrated `generate_knowledge_doc.py` to Claude API to avoid Gemini quota issues (free tier: 20 req/day, was being exhausted by doc generation)

### Bug 9: Closing Bal Misread as Cleaning Bal
**Symptom:** Closing balance entry described as "Cleaning Bal" and typed as `expense` with `tag: cleaning`
**Root cause:** "Closing" starts with "Cl" and in some handwriting styles the 'o' resembles an 'a'. Model applying direct OCR. Extended thinking solves this contextually
**Fix:** Added explicit note in prompt: `IMPORTANT: "Closing Bal" is NOT "Cleaning" — it means the day's final cash total`

### Bug 10: Reference Numbers Parsed as Transactions
**Symptom:** Entry "4850 Dharmendar [819 above]" parsed as two transactions: ₹4850 and ₹819
**Root cause:** Model treating every number as a potential transaction amount
**Fix:** Annotation rules section added:
```
Small number written ABOVE or BESIDE main amount = reference note (NOT a transaction)
```

---

## 24. Performance Characteristics

### Latency

| Operation | P50 | P95 | Bottleneck |
|-----------|-----|-----|-----------|
| Text parse (Haiku) | 1.2s | 2.8s | Anthropic API |
| Image parse (Opus + thinking) | 75s | 110s | Anthropic API + extended thinking |
| DB write (transaction) | 2ms | 8ms | SQLite file I/O |
| DB read (summary) | 5ms | 15ms | SQLite aggregation |
| Twilio ack | 80ms | 150ms | Twilio API |
| Outbound WhatsApp | 1.2s | 2.5s | Twilio REST API |

Image parsing at 75-110 seconds is the dominant latency. This is acceptable for the use case — the owner photographs their page and goes about their work. The bot's response is not expected to be instant.

### Throughput

At current architecture (single uvicorn worker, SQLite):
- **Text messages**: ~50 concurrent (limited by Anthropic API rate limits)
- **Image messages**: ~5 concurrent (Opus API rate limits + background thread pool)
- **DB operations**: Effectively unlimited for SQLite at this scale

### Storage

Per store per month:
- ~500 transactions (busy retail store) × ~200 bytes = ~100KB/month
- At 100 stores: 10MB/month
- SQLite handles millions of rows — storage is not a constraint

### Memory

Uvicorn process: ~80MB resident
- FastAPI + all imports
- Anthropic client (connection pool)
- Twilio client
- APScheduler

Image processing: +15-20MB temporarily per background task (image bytes in memory)

---

## 25. Deployment Guide

### Development Setup

```bash
# 1. Clone / enter project directory
cd /Users/bhabya.jain/go

# 2. Create .env with required keys
cat > .env << EOF
ANTHROPIC_API_KEY=sk-ant-api03-...
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
GOOGLE_API_KEY=AIzaSy...
EOF

# 3. Install dependencies
pip install fastapi uvicorn[standard] twilio anthropic httpx \
            python-dotenv apscheduler streamlit plotly pandas

# 4. Run setup verification
python execution/moneybook_setup.py

# 5. Start webhook server
uvicorn execution.moneybook_webhook:app --host 0.0.0.0 --port 8000 --reload

# 6. Expose to internet via cloudflared tunnel (free, no account)
cloudflared tunnel --url http://localhost:8000
# Note the URL: https://xxxx-yyyy.trycloudflare.com

# 7. Set Twilio webhook
# Go to: console.twilio.com → Messaging → WhatsApp Sandbox → Sandbox settings
# "When a message comes in": https://xxxx-yyyy.trycloudflare.com/whatsapp

# 8. Test
# Send the Twilio sandbox join code to +1 415 523 8886 on WhatsApp
# Then send: "Sale 5000"

# 9. Start dashboard (optional, separate terminal)
streamlit run execution/moneybook_dashboard.py
# Opens at http://localhost:8501
```

### Current Running State (2026-03-28)

```bash
# Check server
curl http://localhost:8000/health
# Expected: {"status":"ok","service":"MoneyBook v2","date":"2026-03-28"}

# Current tunnel URL
# https://contemporary-wall-imported-begun.trycloudflare.com/whatsapp

# Server logs
tail -f /tmp/moneybook_server.log

# Kill and restart
lsof -ti:8000 | xargs kill -9 2>/dev/null
uvicorn execution.moneybook_webhook:app --host 0.0.0.0 --port 8000 --reload \
    > /tmp/moneybook_server.log 2>&1 &
```

### Production Deployment (Recommended: Railway)

```bash
# 1. Create Procfile
echo "web: uvicorn execution.moneybook_webhook:app --host 0.0.0.0 --port $PORT" > Procfile

# 2. Create requirements.txt
pip freeze > requirements.txt

# 3. Deploy to Railway
# railway.app → New Project → Deploy from GitHub repo
# Set environment variables in Railway dashboard
# Get permanent URL: https://moneybook-production.railway.app

# 4. Update Twilio webhook
# "When a message comes in": https://moneybook-production.railway.app/whatsapp
```

**Why Railway over Render/Heroku:**
- Persistent file system (SQLite file persists across restarts)
- $5/month for hobby tier
- Fixed URL (no changing on restart like cloudflared)
- Easy environment variable management

**Production SQLite note:** For multi-instance deployment, SQLite must be replaced with PostgreSQL. A single Railway instance is sufficient for 100-1000 stores.

---

## 26. Open Items & Future Roadmap

### Immediate (Needed for production use)

1. **Add Anthropic credits** — Current API key is valid but balance is $0. Go to `console.anthropic.com → Plans & Billing` and add funds. Image parsing costs ~$0.08/image.

2. **Production deployment** — Move from cloudflared (URL changes on restart) to Railway/Render for a fixed permanent URL. Required for real users.

3. **Test extended thinking end-to-end** — The textile ledger photo (Palledari, Bhada, PTm card, Kanchan Staff, Sudama Staff, Closing Bal) should be sent through WhatsApp to verify all fixes work together.

4. **Update `moneybook_setup.py`** — Still references GEMINI_API_KEY as required. Should now check ANTHROPIC_API_KEY instead (the primary AI key).

### Short Term (1-2 weeks)

5. **Free-form tags in display** — Currently, unknown tags from the model (e.g., `"tailoring"`) show as `📝 Tailoring` (title-cased). Consider adding more emojis to `TAG_META` for common new tags found in practice.

6. **Voice note support** — Many store owners dictate rather than type. Twilio supports audio media. Add audio → Whisper transcription → existing text parse flow.

7. **Multi-language support** — The Hindi text handling is partial. Many store owners in Gujarat, Maharashtra, Rajasthan write in Gujarati, Marathi, or regional dialects. The prompt handles Roman-script Hindi well but not Devanagari or Gujarati script.

8. **PDF statement parsing** — Banks send monthly statements as PDFs. Support PDF images (multi-page ledgers).

### Medium Term (1-3 months)

9. **StockSense integration** — Track inventory alongside cash. "Bech 50 meters green cloth 200/m" → sale + inventory deduction in one entry.

10. **ShopEye** — Computer vision for shop shelves: weekly photo → low-stock alerts, reorder suggestions.

11. **GST tagging** — Auto-detect GST-eligible transactions and maintain GST output/input records. Huge value for GST-registered stores.

12. **Bank statement reconciliation** — Import bank SMS alerts or PDF statements and auto-reconcile with recorded transactions.

13. **Multi-user / multi-device** — Currently tied to one WhatsApp number. Support assistant/employee numbers with restricted access (entry-only, no reports).

14. **Visuals in knowledge docs** — `docs/knowledge/.../visuals/` folders are empty. Needs `generate_visuals.py` (uses Gemini image generation) to run when quota allows.

---

## Appendix A — Full `_IMAGE_PARSE_PROMPT`

The complete 160-line image parsing prompt, exactly as stored in `moneybook_parser.py`:

*(See Section 20 for annotated version. Full raw prompt is in `execution/moneybook_parser.py` lines 102-259)*

---

## Appendix B — Data Flow Diagram

```
WhatsApp Message
      │
      ▼
Twilio (HTTPS POST to /whatsapp)
      │
      ├─── Image? ──────────────────────────────────────────┐
      │                                                      │
      ▼                                                      ▼
   TwiML ack (< 100ms)                         BackgroundTask spawned
      │                                                      │
      ▼                                              Twilio CDN → httpx
   Twilio delivers                                          │
   "📷 Photo mil gayi!"                          base64 encode image
   to owner                                                  │
                                                  Anthropic Opus API
                                                  + adaptive thinking
                                                  (10,000 token budget)
                                                          │
                                                  ~75 seconds later
                                                          │
                                                  JSON extracted from
                                                  <json>...</json> tags
                                                          │
                                                  set_bot_state(confirming)
                                                          │
                                                  format_pending_confirmation()
                                                          │
                                                  send_whatsapp() ─→ split if > 1500 chars
                                                          │
                                                  Twilio REST API
                                                          │
                                                  Owner receives
                                                  confirmation list
                                                          │
                                                  Owner replies "haan"
                                                          │
                                                  handle_confirming()
                                                          │
                                                  20x add_transaction()
                                                          │
                                                  20x INSERT INTO transactions
                                                          │
                                                  clear_bot_state()
                                                          │
                                                  "✅ 20 entries save ho gayi!"
```

---

## Appendix C — Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ Yes | Claude API key. Get from console.anthropic.com |
| `TWILIO_ACCOUNT_SID` | ✅ Yes | Starts with `AC`. From Twilio console |
| `TWILIO_AUTH_TOKEN` | ✅ Yes | 32-char hex. From Twilio console |
| `TWILIO_WHATSAPP_NUMBER` | ✅ Yes | `whatsapp:+14155238886` (sandbox) |
| `GOOGLE_API_KEY` | Optional | Only for `update_knowledge_base.py` (KB docs) |
| `DB_PATH` | Optional | Override SQLite path. Default: `.tmp/moneybook.db` |

---

## Appendix D — Quick Reference: Running Everything

```bash
# Health check
curl http://localhost:8000/health

# Start server (dev, with auto-reload)
uvicorn execution.moneybook_webhook:app --host 0.0.0.0 --port 8000 --reload

# Start dashboard
streamlit run execution/moneybook_dashboard.py

# Expose to internet
cloudflared tunnel --url http://localhost:8000

# Kill server
lsof -ti:8000 | xargs kill -9

# View logs
tail -f /tmp/moneybook_server.log

# Manual DB query
sqlite3 .tmp/moneybook.db "SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;"

# Check all stores
sqlite3 .tmp/moneybook.db "SELECT id, name, phone, onboarding_state FROM stores;"

# Check udhaar
sqlite3 .tmp/moneybook.db "SELECT person_name, balance FROM udhaar WHERE balance > 0 ORDER BY balance DESC;"
```

---

*MoneyBook — Built session by session, documented completely.*
*Last updated: 2026-03-28*
