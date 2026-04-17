# MoneyBook - Product Requirements Document

## Original Problem Statement
1. Run the app and show me the preview
2. Fix deployment issues - migrate from SQLite to MongoDB, fix load_dotenv overrides, add CORS, fix hardcoded URLs
3. Fix photo upload display - images showing as "attachment" text instead of actual photos after deployment

## Architecture
- **Frontend**: Vite + React 18 (at `/app/frontend/`)
- **Backend**: FastAPI (at `/app/execution/`, bridged via `/app/backend/server.py`)
- **Database**: MongoDB (migrated from SQLite) — uses `MONGO_URL` and `DB_NAME` env vars
- **AI Parser**: Claude (Anthropic) with Extended Thinking + Emergent LLM proxy
- **Image Serving**: FastAPI static files at `/api/uploads/` (routed through K8s ingress)
- **WhatsApp**: Twilio webhook integration
- **Mobile**: Capacitor (Android/iOS ready), React Native (moneybook-rn)

## What's Been Implemented
- [2026-04-16] Initial setup + deployment fixes (SQLite→MongoDB, dotenv, CORS, symlink→real dir)
- [2026-04-17] **Image display fix**:
  - Root cause: `/uploads/` path was routed to frontend by K8s ingress (not prefixed with `/api`)
  - Changed static file mount from `/uploads` → `/api/uploads`
  - Changed media_url format from `/uploads/file` → `/api/uploads/file`
  - Added `normalizeImageUrl()` helper in MessageBubble.jsx and OperatorDashboard.jsx for legacy URL compatibility
  - Removed unnecessary `/uploads` proxy from vite.config.js
  - Improved image alt text for accessibility

## Testing Results
- Backend: 100% (10/10 tests including image upload)
- Frontend: 100% (image display, login, chat, navigation)
- Integration: 100% (image upload and serving through /api/uploads/)

## Prioritized Backlog
### P1 (Important)
- Test AI parsing flow with real Anthropic key
- Configure Twilio credentials for WhatsApp webhook

### P2 (Nice to have)
- Cloud storage for uploads (currently filesystem — ephemeral in K8s pods)
- Production build optimization
- Capacitor native builds
