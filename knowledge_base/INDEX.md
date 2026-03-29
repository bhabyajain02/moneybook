# Knowledge Base Index

> Auto-updated after every conversation. Portable Markdown — plug into any AI tool.
> Last updated: 2026-03-27

## How to use this KB
- **With Claude/ChatGPT/Gemini**: Paste the relevant topic file as context
- **With Cursor/Copilot**: Add `knowledge_base/` to your workspace
- **Search**: All files are plain Markdown — `grep -r "keyword" knowledge_base/`
- **Full context dump**: Share `INDEX.md` + relevant topic files with any AI to get a fully informed assistant

---

## Topics

### Architecture & Systems
- [3-Layer Architecture](topics/architecture/three-layer-architecture.md) — Directive → Orchestration → Execution pattern
- [Self-Annealing Loop](topics/architecture/self-annealing.md) — How the system learns from errors

### Tools & APIs
- [Nano Banana Pro / Gemini Image API](topics/tools/nano-banana-pro.md) — Image generation via Google Gemini
- [Gemini Text API](topics/tools/gemini-text-api.md) — Text generation, models, usage patterns

### Python Scripting
- [Script Patterns](topics/python/script-patterns.md) — Reusable patterns across execution scripts
- [Error Handling](topics/python/error-handling.md) — Rate limits, retries, backoff strategies

### Project Setup
- [Environment Setup](topics/setup/environment.md) — .env, .gitignore, dependencies
- [Directory Conventions](topics/setup/directory-conventions.md) — How folders are organized

### Knowledge & Documentation
- [Knowledge Doc Protocol](topics/documentation/knowledge-doc-protocol.md) — 3-level docs + visuals
- [Knowledge Base Management](topics/documentation/knowledge-base-management.md) — This system itself

---

## Session Log
Chronological record of all conversations and what was built/learned.

| Date | Session | Key Outcomes |
|------|---------|--------------|
| 2026-03-27 | [Initial Setup](sessions/2026-03-27_initial-setup.md) | Built 3-layer architecture, Knowledge Doc protocol, Nano Banana Pro integration, Knowledge Base |
| 2026-03-28 | [Built MoneyBook: WhatsApp Financial Tracker](sessions/2026-03-28_built-moneybook-whatsapp-financial-tracker.md) | Webhook services often have strict response time limits (e.g., Twilio's 15s); offload long-running tasks to background processes and use the service's REST API for delayed responses.; Explicit `pathlib.Path` resolution is crucial for reliable `.env` file loading, especially in complex project structures. |
| 2026-03-28 | [MoneyBook Technical Reference Document Creation](sessions/2026-03-28_moneybook-technical-reference-document-creation.md) | Understanding the breadth of topics required for a complete technical reference document, from product overview to deployment and roadmap.; Gained detailed insight into MoneyBook's specific components, including its 6-table SQL schema, 4 Python files, 3 AI prompts, and 10 identified bugs with fixes. |

---

## Quick Reference Cards

### Run a Knowledge Doc after any session
```bash
python execution/generate_knowledge_doc.py \
  --topic "what we built" \
  --notes "summary of session"
```

### Update the Knowledge Base after any session
```bash
python execution/update_knowledge_base.py \
  --session_summary "what happened" \
  --topics "architecture,python,apis"
```

### Generate visuals only
```bash
python execution/generate_visuals.py \
  --topic "topic name" \
  --output_dir "docs/knowledge/DATE_slug/visuals"
```
