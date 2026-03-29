# Session: Built MoneyBook: WhatsApp Financial Tracker

**Date:** 2026-03-28
**Status:** Complete

---

## What happened
An end-to-end WhatsApp-based financial tracking system, MoneyBook, was built for Indian retail store owners. It parses handwritten notebook photos and text messages, stores transactions in SQLite, and provides summaries, leveraging FastAPI, Twilio, and Claude API.

## Raw notes
Built MoneyBook end-to-end: a WhatsApp-based financial tracking system for Indian retail store owners who manage finances in handwritten notebooks. Used Twilio sandbox for WhatsApp, FastAPI for the webhook server, SQLite for storage, and Claude API (Sonnet for vision, Haiku for text) for parsing. Key components: (1) moneybook_parser.py parses both text messages and notebook photos (Hindi/Gujarati/English) into structured JSON transactions with tags, (2) moneybook_db.py has SQLite with tables for stores, transactions, udhaar, persons, store_corrections and per-store correction learning using few-shot examples, (3) moneybook_webhook.py has FastAPI with conversation state machine (idle/confirming/correcting/classifying), APScheduler for daily summaries, BackgroundTasks to handle Twilio 15s timeout. Major bugs fixed: load_dotenv not finding .env when running from subdirectory fixed with explicit Path resolution, Twilio image redirects fixed with follow_redirects=True, Twilio 15s webhook timeout fixed by moving image processing to BackgroundTasks and returning instant ack while sending result later via Twilio REST API, Gemini quota exceeded so switched entire parser to Anthropic Claude API, deprecated Claude model names updated to claude-haiku-4-5 and claude-sonnet-4-5, /summary command showing only header because data was on previous date fixed with fallback to most recent date with data, duplicate transactions from double confirmation fixed with 10-minute dedup window in add_transaction. Accuracy improvement: replaced two-pass OCR approach (image to text to JSON via Haiku) with single-pass vision (image to JSON directly via Sonnet) to preserve spatial layout context, fixing missing entries like 60-Phenyl at top of right column. Added Indian number format rules (1,12,923 = 112923 not 11292) and misspelling dictionary (OPI to UPI, Finail to Phenyl). Cloudflared tunnel used for localhost exposure to Twilio with URL changing on every restart.

## Key decisions
- Switched from Gemini to Anthropic Claude API for parsing due to quota exceeded issues.
- Replaced a two-pass OCR approach with single-pass vision (Claude Sonnet) for direct image-to-JSON parsing to preserve spatial layout context and improve accuracy.
- Implemented FastAPI `BackgroundTasks` to handle Twilio's 15-second webhook timeout by returning an instant acknowledgment and sending results later via the Twilio REST API.
- Introduced a 10-minute deduplication window for transactions to prevent duplicates from double confirmations.
- Resolved `load_dotenv` issues when running from subdirectories by using explicit `pathlib.Path` resolution.

## Learnings
- Webhook services often have strict response time limits (e.g., Twilio's 15s); offload long-running tasks to background processes and use the service's REST API for delayed responses.
- Explicit `pathlib.Path` resolution is crucial for reliable `.env` file loading, especially in complex project structures.
- When processing images from external services, ensure HTTP clients are configured to follow redirects (`follow_redirects=True`).
- Direct vision models (like Claude Sonnet) can significantly outperform a two-pass OCR + text LLM approach for structured data extraction from images, particularly for layout-sensitive documents.
- Staying updated with LLM model names and versions is essential (e.g., `claude-haiku-4-5`, `claude-sonnet-4-5`).
- Custom parsing logic for locale-specific number formats (e.g., Indian lakhs/crores) and domain-specific misspelling dictionaries are vital for high accuracy in specialized applications.
- Cloudflared tunnels are useful for exposing localhost but require dynamic URL updates if the tunnel restarts.

## Open questions

