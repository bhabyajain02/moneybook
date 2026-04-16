# MoneyBook - Product Requirements Document

## Original Problem Statement
1. Run the app and show me the preview
2. Fix deployment issues - migrate from SQLite to MongoDB, fix load_dotenv overrides, add CORS, fix hardcoded URLs

## Architecture
- **Frontend**: Vite + React 18 (in `/app/webapp/`, symlinked as `/app/frontend/`)
- **Backend**: FastAPI (in `/app/execution/`, bridged via `/app/backend/server.py`)
- **Database**: MongoDB (migrated from SQLite) — uses `MONGO_URL` and `DB_NAME` env vars
- **AI Parser**: Claude (Anthropic) with Extended Thinking + Emergent LLM proxy
- **WhatsApp**: Twilio webhook integration
- **Mobile**: Capacitor (Android/iOS ready)

## User Personas
1. **Small Indian Shopkeepers** — Primary users, record daily transactions via chat
2. **Store Operators** — Admin dashboard for image review and queue management

## Core Requirements (Static)
- Phone-based login (no password)
- WhatsApp-style chat interface for recording transactions
- AI-powered text and image parsing (notebook photos)
- Transaction confirmation with editable entries
- Person classification (staff/customer/supplier/home)
- Analytics dashboard (daily/weekly/monthly/yearly)
- Dues (udhaar) tracking with per-person history
- Staff payment tracking
- Multi-language support (10 Indian languages)
- Operator dashboard for manual image review

## What's Been Implemented
- [2026-04-16] Initial setup: bridged backend, symlinked frontend, configured Vite
- [2026-04-16] **Deployment fixes**:
  - Migrated entire database layer (`moneybook_db.py`, 1800+ lines) from SQLite to MongoDB
  - Fixed `load_dotenv(override=True)` → `override=False` in 4 files (webhook, parser, db, knowledge_doc)
  - Added CORS middleware to FastAPI app
  - Fixed hardcoded fallback URL in `api.js`
  - Replaced all raw SQL (`get_db()`) calls in `moneybook_webhook.py` and `moneybook_eval.py` with MongoDB helpers
  - Created `requirements.txt` with pip freeze
  - Created bridge `server.py` for supervisor compatibility

## Testing Results
- Backend: 100% (8/8 tests passed)
- Frontend: 100% (all UI elements and flows working)  
- Integration: 100% (frontend-backend communication working)

## Prioritized Backlog
### P0 (Critical)
- All deployment blockers resolved ✅

### P1 (Important)
- Test AI parsing flow with real Anthropic key
- Configure Twilio credentials for WhatsApp webhook

### P2 (Nice to have)
- Production build and static serving
- Capacitor native builds
- Daily business insights digest

## Next Tasks
1. Deploy to production via Emergent deployment
2. Configure Twilio credentials if WhatsApp needed
3. Test AI parsing end-to-end
