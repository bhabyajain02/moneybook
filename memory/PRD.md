# MoneyBook - Product Requirements Document

## Original Problem Statement
Run the app and show me the preview.

## Architecture
- **Frontend**: Vite + React 18 (in `/app/webapp/`, symlinked as `/app/frontend/`)
- **Backend**: FastAPI + SQLite (in `/app/execution/`, bridged via `/app/backend/server.py`)
- **Database**: SQLite at `/app/.tmp/moneybook.db`
- **AI Parser**: Claude (Anthropic) with Extended Thinking, Gemini fallback
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
- [2026-04-16] Initial setup: bridged backend, symlinked frontend, configured Vite for preview environment, installed dependencies, set up Emergent LLM key for Anthropic API

## Prioritized Backlog
### P0 (Critical)
- Twilio WhatsApp webhook (needs credentials)

### P1 (Important)
- Test full transaction flow via web chat
- Test image upload and AI parsing

### P2 (Nice to have)
- Production build and static serving
- Capacitor native builds
- Daily business insights digest

## Next Tasks
1. Test login and chat flow end-to-end
2. Configure Twilio credentials if WhatsApp needed
3. Test AI parsing with Emergent LLM proxy
