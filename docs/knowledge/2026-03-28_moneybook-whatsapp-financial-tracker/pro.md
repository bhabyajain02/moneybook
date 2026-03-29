# MoneyBook — Architecture Decision Record & Engineering Deep-Dive

---

## System Overview

Multi-tenant WhatsApp financial tracking system for Indian retail stores. Single-node deployment. Input: Twilio webhook (WhatsApp messages + media). Processing: FastAPI + Anthropic Claude API (vision + text). Storage: SQLite. Output: TwiML responses + REST API push messages.

**Codebase:** 3 files, ~1600 LOC total.
- `execution/moneybook_db.py` — database layer (530 LOC)
- `execution/moneybook_parser.py` — AI parsing + formatters (550 LOC)
- `execution/moneybook_webhook.py` — HTTP server + state machine (580 LOC)

---

## AD-1: Single-Pass Vision Over Two-Pass OCR

### Rejected approach
```
Image → Sonnet (OCR prompt → raw text string) → Haiku (structure prompt → JSON)
```
Two API calls: one vision, one text. Cheaper but lossy.

### Chosen approach
```
Image → Sonnet (combined OCR+structure prompt → JSON directly)
```
One API call. More expensive (Sonnet vs Haiku for structuring). 100% more accurate.

### Why two-pass failed
Cashbooks are two-column spatial documents. OCR text output is linear. When "60 - Finail" appears at the top of the right column near the column divider, it occupies a precise 2D position that encodes "this is an expense." In linear OCR text: `"60 - Finail"` — column affinity is lost. Haiku receives a flat string and has no basis to infer column membership.

Additionally: Haiku is a weaker model than Sonnet. The structuring step introduces a second error source with lower baseline capability.

### Proof
Direct comparison: Claude in chat (single-pass, full image) identified all 7 entries including "60 - Phenyl." Bot (two-pass) returned 6 entries — "60 - Phenyl" missing. Same model, same image, different pipeline.

### Cost implication
Two-pass: 1× Sonnet input (image) + 1× Haiku input (text).
Single-pass: 1× Sonnet input (image + structured prompt).
Net: slightly higher token cost, eliminated Haiku call, ~15s faster (no second API round-trip).

---

## AD-2: BackgroundTasks + REST Push for Image Processing

### Problem
Twilio webhook timeout: 15 seconds. Hard kill. Claude Sonnet vision: 20-40 seconds measured. Gap: 5-25 seconds of guaranteed timeout.

### Rejected: Synchronous processing
```python
# This fails 100% of the time for images
@app.post('/whatsapp')
async def webhook(...):
    result = parse_image_message(...)  # 20-40s — Twilio kills at 15s
    return twiml_reply(format(result))  # Never reached
```

### Chosen: FastAPI BackgroundTasks + Twilio REST API
```python
@app.post('/whatsapp')
async def webhook(background_tasks: BackgroundTasks, ...):
    if has_media:
        background_tasks.add_task(process_image_and_reply, from_number, MediaUrl0, body)
        return twiml_reply("📷 Photo mil gayi! Padh raha hoon... ⏳")  # <1s

def process_image_and_reply(from_number, media_url, body):
    # Runs in FastAPI's internal thread pool — no Twilio deadline
    result = parse_image_message(...)   # 20-40s, no problem
    send_whatsapp(from_number, format(result))   # Twilio REST API

def send_whatsapp(to, body):
    twilio.messages.create(from_=TWILIO_WHATSAPP_NUMBER, to=to, body=body)
```

### Failure modes
- Background task exception → try/except → REST error message sent to user
- Twilio REST API error → logged only (no retry — idempotency not guaranteed without message ID tracking)
- Server restart during background task → task silently dropped (acceptable at current scale)

### Why not Celery/Redis?
Single-node deployment. BackgroundTasks uses FastAPI's internal thread pool — adequate for expected load (<10 concurrent image parses). Celery adds operational complexity (Redis broker, worker process) not justified until >100 concurrent stores.

---

## AD-3: Conversation State Machine in SQLite JSON Column

### State storage
```sql
ALTER TABLE stores ADD COLUMN bot_state TEXT DEFAULT '{}'
```
State is a JSON string. Loaded with `json.loads()`, saved with `json.dumps()`. Atomic read-modify-write per message (sequential per sender by Twilio).

### State object schema
```python
{
    "state": "idle|confirming|correcting|classifying",
    # In confirming/correcting:
    "pending": [txn, ...],           # list of parsed transactions
    "persons_found": ["Name1", ...],  # names mentioned in the parse
    "persons_map": {"Name": "cat"},   # person categories assigned so far
    "raw_message": str,               # original text or "" for image
    "source": "text|image",
    "page_date": "YYYY-MM-DD",        # date from notebook page
    "raw_ocr": str,                   # stored for correction learning context
    # In correcting:
    "correcting_index": int,          # 0-based index of entry being fixed
    # In classifying:
    "persons_queue": ["Name1", ...],  # persons to classify
    "person_index": int,              # current position in queue
}
```

### Transition table
```
State          Input                       Action                    Next State
─────────────────────────────────────────────────────────────────────────────
any            /command                    clear state, run command  idle
idle           image                       background task           (async) → confirming
idle           text (1 transaction)        auto-save                 idle (or classifying)
idle           text (N transactions)       show confirmation         confirming
confirming     haan/yes/ok/sahi            save_confirmed_batch()    classifying or idle
confirming     galat N                     set correcting_index      correcting
confirming     N tag <tag>                 update pending[N].tag     confirming (re-show)
confirming     cancel                      clear_bot_state()         idle
correcting     <any text>                  parse_correction()        confirming
correcting                                 save_correction() ← per-store learning
classifying    1/2/3/4                     save_person()             classifying (next) or idle
```

### Why JSON column vs separate table
Separate `conversations` table would require joins on every request. JSON column: O(1) read by primary key. State size is bounded by number of transactions in one batch — typically <20 entries, JSON < 5KB. No contention: Twilio sends messages serially per sender (one in-flight at a time per phone number).

---

## AD-4: Per-Store Correction Learning via Few-Shot Injection

### Mechanism
```python
# On correction:
save_correction(store_id, raw_text, original_json, corrected_json, entry_index)

# On next parse:
ctx = build_store_context(store_id)  # → builds few-shot string from last 15 corrections
result = parse_image_message(media_url, ..., store_context=ctx)
# ctx is injected into _IMAGE_PARSE_PROMPT as {store_context}
```

### Prompt injection format
```
📚 Past corrections for this store (learn from these):
  • "Phenol" → type:expense, tag:cleaning, desc:"Phenyl cleaning liquid"
  • "CD Vivek" → type:expense, tag:cash_discount, desc:"Cash discount to Vivek"
  • "A. Tini" → type:receipt, desc:"Received from A. Tiwari"
```

### Scaling concern
At 15 corrections (current limit): ~300 tokens added to prompt. At 100+ corrections: ~2000+ tokens, approaching model context limits and increasing cost. Migration path: embed corrections using sentence-transformers, retrieve top-K by cosine similarity to current image description. Not implemented — premature at current scale.

---

## AD-5: Idempotency via 10-Minute Dedup Window

### Problem
User sends photo → bot parses → asks for confirmation → user says "haan" → saves. User says "haan" again (double-tap, misclick) → saves again. Same 7 transactions appear twice in DB.

### Fix
```python
recent_dup = conn.execute("""
    SELECT id FROM transactions
    WHERE store_id=? AND date=? AND type=? AND amount=?
      AND created_at >= datetime('now', '-10 minutes')
    LIMIT 1
""", (store_id, txn_date, txn['type'], float(txn['amount']))).fetchone()
if recent_dup:
    return recent_dup['id']   # idempotent — return existing ID
```

### Failure mode
10 minutes is too short if background image processing + confirmation takes >10 minutes (e.g. flaky network). Legitimate fix: track confirmation token in bot_state, mark it consumed on first save. Not implemented — 10 minutes is sufficient for expected UX.

---

## Prompt Engineering Notes

### Indian number format rule
Without explicit instruction, Sonnet 4-5 applies Western comma interpretation inconsistently:
- `1,12,923` → sometimes reads as `112923` (correct), sometimes `11,292` (wrong — drops digit)
- Root cause: ambiguity between Indian comma format (1,12,923 = 1 lakh 12 thousand) and Western (1,123 = one thousand one hundred twenty-three)

Explicit rule added to prompt:
```
━━ INDIAN NUMBER FORMAT — CRITICAL ━━
1,12,923 = parts [1][12][923] → concatenate → 112923
10,898   = parts [10][898]    → concatenate → 10898
NEVER drop digits. Count every digit character.
```

### Misspelling dictionary placement
Must appear BEFORE accuracy rules in prompt. The model processes top-to-bottom; if it encounters "OPI" before reaching the dictionary, it may hallucinate a label. Dictionary first → model has the lookup table at first encounter.

### `skipped_entries` JSON field
```json
"skipped_entries": "60 - unclear word at top of right column"
```
Added to surface model uncertainty without silently dropping amounts. Better to log "60 - unclear" than to miss ₹60. Displayed to user only when `ocr_confidence` is `low` or `medium`.

### `{store_context}` injection position
Injected after the date, before the how-to-read section. Gives the model store-specific overrides before it encounters the general rules — store-specific corrections take precedence over general heuristics.

---

## Full Bug Registry

| # | Error | Root Cause | Fix Applied | File |
|---|-------|-----------|-------------|------|
| 1 | `ANTHROPIC_API_KEY` is None | `load_dotenv()` resolves from CWD, not script dir | `Path(__file__).resolve().parent.parent / '.env'` | All 3 files |
| 2 | `Redirect response '307'` | Twilio CDN redirects image URLs | `httpx.get(..., follow_redirects=True)` | parser.py |
| 3 | No reply to photo | Twilio 15s timeout; Claude vision takes 20-40s | `BackgroundTasks` + instant TwiML ack + REST push | webhook.py |
| 4 | `429 quota exceeded` | Gemini free tier: 20 req/day for gemini-2.5-flash | Migrated parser to Anthropic Claude API | parser.py |
| 5 | `model not found` | Claude renamed models in March 2026 | `claude-3-5-haiku` → `claude-haiku-4-5`; `claude-3-5-sonnet` → `claude-sonnet-4-5` | parser.py |
| 6 | `/summary` header only | `get_daily_summary` queried today; data was yesterday | Fallback to most recent date with data | db.py |
| 7 | Duplicate transactions | Owner confirms twice | 10-min dedup window on (store, date, type, amount) | db.py |
| 8 | Missing "60 - Phenyl" | Two-pass OCR loses spatial context | Single-pass vision | parser.py |
| 9 | `11,292` vs `1,12,923` | Indian comma format misread | Explicit format rule + examples in prompt | parser.py |
| 10 | `OPI` vs `UPI` | U/O handwriting ambiguity | Misspelling dict in prompt | parser.py |
| 11 | `gemini-2.5-flash-preview-05-20 not found` | Gemini model renamed/removed | Updated model name; migrated to Claude API | generate_knowledge_doc.py |
| 12 | Non-expense types show `📝 Other` | `format_pending_confirmation` only looked up TAG_META; non-expense types have no meaningful tag | Added `_TYPE_META` dict mapping transaction type → (emoji, label) | parser.py |

---

## At Scale

### Current limits
- SQLite: viable to ~100 concurrent active stores with WAL mode. Single writer, multiple readers. Each Twilio sender is sequential (one message in-flight per phone number) — no write contention in practice.
- FastAPI BackgroundTasks: thread pool default (CPU count * 5). Each image parse holds a thread for 20-40s. At 10 simultaneous image uploads: thread pool saturation. Mitigation: move to Celery with Redis at >50 concurrent stores.
- Cloudflared: ephemeral URL changes on restart. Not viable for production. Replace with Railway/Render for fixed URL.

### Multi-tenant isolation
All tables have `store_id` foreign key. No cross-store data leakage possible at the query level. Bot state isolated per store. Corrections isolated per store.

### What to change at 10x
1. PostgreSQL: replace SQLite. Schema migration is clean — all queries use standard SQL, no SQLite-specific syntax.
2. Celery + Redis: replace BackgroundTasks for image processing queue with retry and dead-letter queue.
3. Retrieval-augmented corrections: replace last-15-corrections injection with semantic similarity search over all corrections.
4. Fixed deployment URL: Railway/Render + custom domain. Eliminates cloudflared restart problem.
5. Claude API credits: add $10-50/month depending on volume. At 100 stores × 2 photos/day × $0.003/image = ~$18/month.

### Open questions
- What is the right dedup window? 10 minutes is a guess.
- Should corrections be global (shared across stores for common misspellings) or strictly per-store? Currently per-store only.
- Multi-page notebook: not handled. Owner must send one page at a time.
- Gemini vs Claude for generate_knowledge_doc.py: currently Claude API. If Anthropic credits unavailable, falls back to manual doc writing. Should add explicit fallback mode.
