# MoneyBook Directive

## What is MoneyBook?
A WhatsApp-based financial tracking system for small retail store owners.
Store owners send WhatsApp messages (text OR notebook photos) and MoneyBook
automatically parses, stores, and summarises their daily financials.

---

## Inputs
| Input Type | Description |
|------------|-------------|
| WhatsApp text | Free-form Hindi/Gujarati/English: "Sale 5000", "Raju ne 500 udhaar liya" |
| WhatsApp image | Photo of handwritten cash book page — Gemini Vision reads it |
| Commands | `/summary`, `/udhaar`, `/week`, `/help` |

## Outputs
| Output | When |
|--------|------|
| Transaction confirmation | Immediately after each entry |
| Daily summary | Every day at 9 PM (IST) automatically |
| Udhaar aging alert | Every Monday at 9 AM (IST) automatically |
| Weekly P&L | On demand via `/week` |
| Streamlit dashboard | Always available at http://localhost:8501 |

---

## Transaction Types
| Type | Description | Example |
|------|-------------|---------|
| `sale` | Revenue from selling goods | "Sale 5000 cash" |
| `expense` | Any outgoing payment | "Bijli bill 800", "CD Raju 500" |
| `udhaar_given` | Credit extended to customer | "Raju ne 500 udhaar liya" |
| `udhaar_received` | Payment received from credit customer | "Raju ne 300 wapas diya" |
| `bank_deposit` | Money deposited in bank | "Bank mein 50000 jama kiya" |
| `opening_balance` | Starting cash balance for the day | "Opening 49876" |
| `cash_in_hand` | Physical cash at end of day | "Cash 13184" or denomination breakdown |
| `upi_in_hand` | UPI balance at end of day | "UPI 36897" |

---

## Scripts
| File | Purpose |
|------|---------|
| `execution/moneybook_db.py` | SQLite schema + all CRUD operations |
| `execution/moneybook_parser.py` | Gemini text + image parsing + WhatsApp formatters |
| `execution/moneybook_webhook.py` | FastAPI server — main entry point |
| `execution/moneybook_dashboard.py` | Streamlit visual dashboard |
| `execution/moneybook_setup.py` | One-time setup check + next-steps guide |

---

## Setup (First Time)
```bash
# 1. Install dependencies
pip install -r requirements_moneybook.txt

# 2. Fill in .env with Twilio credentials (GEMINI_API_KEY already set)
#    Get from: https://console.twilio.com → Account Info
#    TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxx
#    TWILIO_AUTH_TOKEN=your_auth_token

# 3. Run setup check
python execution/moneybook_setup.py

# 4. Start server (Terminal 1)
uvicorn execution.moneybook_webhook:app --reload --port 8000

# 5. Expose to internet (Terminal 2) — required for Twilio webhook
ngrok http 8000

# 6. Start dashboard (Terminal 3)
streamlit run execution/moneybook_dashboard.py

# 7. In Twilio Console:
#    Messaging → Try it out → Send a WhatsApp message → Sandbox Settings
#    "When a message comes in" → https://<ngrok-url>/whatsapp
```

---

## Notebook Image Format (from real store samples)
Store owners use a **two-column cash book**:

```
LEFT (Money IN)              RIGHT (Money OUT)
─────────────────────────    ─────────────────────────────
49876  - Opening Balance     190130 - Bank Deposit
150000 - Roopam              695    - CD A. Tini
2000   - Manual Advance      12000  - Dues Shyam
51489  - Sale                379    - CD P. Charby
                             30     - Copy Archive
                             50     - Transport Labour
                             36897  - UPI
                             13184  - Cash
253365 - Total               253365 - Total
```

- `CD [name]` = Cash Drawn = payment made to that person = `expense`
- `UPI` = day's digital payments received = `upi_in_hand`
- `Cash` (with denomination math) = physical cash = `cash_in_hand`
- Names beside amounts = people (supplier / udhaar / payment)

---

## Gemini Models Used
- `gemini-2.5-flash` — text parsing AND vision (image reading). Use this.
- `gemini-2.0-flash` — fallback if 2.5 quota is hit
- Handles Hindi, Gujarati, English, and mixed text natively
- **API Quota note**: Free tier has per-model daily limits. If 429 error hits,
  switch model in `moneybook_parser.py` MODEL line. Available models listed via
  `genai.list_models()`. Each model has an independent quota.

---

## Database Schema (SQLite)
```
stores             — one row per WhatsApp number
transactions       — every financial entry ever
udhaar             — running balance per person
udhaar_transactions — individual credit/debit events per person
```

Database path: `.tmp/moneybook.db` (auto-created; not committed to git)

---

## Error Handling
| Error | Response |
|-------|----------|
| Gemini can't parse text | Friendly prompt to rephrase with example |
| Image too blurry | Ask for clearer photo |
| No amount found | Ask owner to include amount |
| Twilio send failure | Logged; Twilio handles retry |
| DB error | Transaction rolled back; error logged |

---

## Scheduled Jobs (APScheduler)
| Job | Schedule | Action |
|-----|----------|--------|
| `job_daily_summary` | 9 PM IST daily | WhatsApp summary to all active stores |
| `job_udhaar_alerts` | 9 AM IST Monday | Alert stores about udhaar > 30 days old |

---

## Conversation State Machine (v2)
The bot uses a 4-state machine stored per store in `stores.bot_state` (JSON):

| State | Trigger | Owner does |
|-------|---------|-----------|
| `idle` | Default | Sends text or photo |
| `confirming` | Multi-entry parsed | Types 'haan', 'galat N', '3 tag electricity', or 'cancel' |
| `correcting` | Typed 'galat N' | Sends corrected info for that entry |
| `classifying` | Unknown person found | Sends 1/2/3/4 to classify |

### Tag correction format
While in `confirming` state:
- `3 tag electricity` → changes entry 3's tag to 'electricity'
- All available tags listed in parser.py `TAG_META`

### Person classification
- On first encounter of a name → bot asks: Staff/Customer/Supplier/Ghar
- Saved in `persons` table, auto-applied to future transactions with same name
- Categories: `staff`, `customer`, `supplier`, `home`, `other`

## Learnings & Edge Cases
- **CD = Cash Discount** (NOT Cash Drawn) — confirmed from real store notebooks
- **A. Tini = A. Tiwari, P. Charby = P. Choubey** — OCR may mis-read handwriting; owner can correct via 'galat N'
- **Mixed-language input**: Gemini handles Hindi + Gujarati + English in the same message
- **Two-column format**: Image parser instructed to treat LEFT=IN, RIGHT=OUT
- **Denomination math**: "500×6 = 3000, 100×68 = 6800" → parser sums these as `cash_in_hand`
- **Udhaar direction**: Owner says "Raju ne udhaar liya" → store GAVE udhaar → `udhaar_given`
- **Python 3.9**: Use `Optional[dict]` not `dict | None` (union syntax requires 3.10+)
- **Twilio image redirect**: Twilio MediaUrls return a `307 Temporary Redirect` to their CDN. Always use `follow_redirects=True` in `httpx.get()` when fetching Twilio media
- **Twilio 15s webhook timeout**: Image download + Gemini Vision takes 20-30s. Solution: return `200 OK` instantly with an ack message, then process image in a `BackgroundTask` and push the real reply via Twilio REST API (`send_whatsapp()`). Never do slow work inside the webhook handler itself.
- **Gemini quota**: 2.5-flash has separate quota from 2.0-flash; switch model in parser if 429 hit
- **Twilio sandbox**: Number changes after 24h inactivity; re-send join code to reset

---

## Future Enhancements
- Voice note support (Twilio → STT → Gemini parse)
- Multi-store (already schema-ready — just needs auth layer)
- StockSense integration (link inventory to sales transactions)
- ShopEye integration (link camera footfall to sales conversion)
- Hindi/Gujarati response for alerts (currently English)
