# MoneyBook - Product Requirements Document

## Original Problem Statement
1. Run the app and show me the preview
2. Fix deployment issues - migrate from SQLite to MongoDB, fix load_dotenv overrides, add CORS, fix hardcoded URLs
3. Fix photo upload display - images showing as "attachment" text instead of actual photos
4. Fix admin page AI pre-fill - details not getting filled in production after image upload

## Architecture
- **Frontend**: Vite + React 18 (at `/app/frontend/`)
- **Backend**: FastAPI (at `/app/execution/`, bridged via `/app/backend/server.py`)
- **Database**: MongoDB (migrated from SQLite)
- **AI Parser**: Claude via `emergentintegrations` library (Emergent LLM key) with Gemini fallback
- **Image Serving**: FastAPI static files at `/api/uploads/`
- **WhatsApp**: Twilio webhook integration
- **Mobile**: Capacitor, React Native

## What's Been Implemented
- [2026-04-16] Initial setup + deployment fixes (SQLite→MongoDB, dotenv, CORS, symlink→real dir)
- [2026-04-17] Image display fix (moved serving to /api/uploads/)
- [2026-04-17] **AI pre-fill fix**:
  - Root cause: Standard Anthropic SDK with Emergent proxy URL produced double `/v1/v1/` path → 404
  - Emergent LLM key requires `emergentintegrations` library, not direct SDK
  - Replaced `_call_claude` with `_call_claude_emergent` using `LlmChat` from `emergentintegrations`
  - Added model name mapping (claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5)
  - Added sync-to-async bridge for calling async `send_message()` from sync parser
  - Kept original `_call_claude_sdk` for users with direct Anthropic API keys

## Testing Results
- Backend: 100% (14/14 tests)
- Frontend: 95% (minor queue refresh timing)
- Integration: 100% (AI shadow parse working, admin pre-fill working)

## Prioritized Backlog
### P1
- Cloud storage for uploads (K8s pod filesystem is ephemeral)
- Configure Twilio for WhatsApp webhook

### P2
- Production build optimization
- Capacitor native builds
