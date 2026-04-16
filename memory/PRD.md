# MoneyBook - Product Requirements Document

## Original Problem Statement
1. Run the app and show me the preview
2. Fix deployment issues - migrate from SQLite to MongoDB, fix load_dotenv overrides, add CORS, fix hardcoded URLs

## Architecture
- **Frontend**: Vite + React 18 (at `/app/frontend/`)
- **Backend**: FastAPI (at `/app/execution/`, bridged via `/app/backend/server.py`)
- **Database**: MongoDB (migrated from SQLite) — uses `MONGO_URL` and `DB_NAME` env vars
- **AI Parser**: Claude (Anthropic) with Extended Thinking + Emergent LLM proxy
- **WhatsApp**: Twilio webhook integration
- **Mobile**: Capacitor (Android/iOS ready), React Native (moneybook-rn)

## User Personas
1. **Small Indian Shopkeepers** — Primary users, record daily transactions via chat
2. **Store Operators** — Admin dashboard for image review and queue management

## What's Been Implemented
- [2026-04-16] Initial setup: bridged backend, configured Vite for preview
- [2026-04-16] **Deployment fixes (round 1)**:
  - Migrated entire database layer (`moneybook_db.py`, 1800+ lines) from SQLite to MongoDB
  - Fixed `load_dotenv(override=True)` → `override=False` in 4 files
  - Added CORS middleware to FastAPI app
  - Fixed hardcoded fallback URL in `api.js`
  - Replaced all raw SQL calls with MongoDB helpers
  - Created `requirements.txt`
- [2026-04-16] **Deployment fixes (round 2)**:
  - Replaced symlink with real directory (moved `/app/webapp/` → `/app/frontend/`)
  - Updated `_webapp_dist` path from `webapp` to `frontend` in webhook
  - Added `/api/health` health check route alongside `/health`
  - Fixed hardcoded URL in `moneybook-rn/src/config.js`
  - Verified frontend builds successfully with `yarn build`

## Deployment Status
- **Deployment Agent**: ✅ PASS — All checks green
- **Backend**: 100% tests passing (MongoDB, health check, CORS, all APIs)
- **Frontend**: 100% tests passing (login, chat, navigation, build)
- **Integration**: 100% (frontend↔backend communication working)

## Prioritized Backlog
### P0 (Critical)
- All deployment blockers resolved ✅

### P1 (Important)
- Test AI parsing flow with real Anthropic key in production
- Configure Twilio credentials for WhatsApp webhook

### P2 (Nice to have)
- Production static file serving optimization
- Capacitor native builds
- Daily business insights digest
