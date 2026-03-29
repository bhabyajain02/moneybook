# Directive: Knowledge Base Management

## Purpose
Maintain a persistent, portable knowledge base that captures everything learned across all conversations.
The KB lives in `knowledge_base/` and must be updated at the end of every session.

## When to trigger
At the end of **every conversation** that involves:
- Building or modifying anything
- Debugging or fixing something
- Learning about a new tool, API, or concept
- Making architectural or design decisions
- Any multi-step workflow

## Script to use
`execution/update_knowledge_base.py`

## Inputs
| Parameter | Type | Description |
|-----------|------|-------------|
| `--session_summary` | str | What happened in this session (2-5 sentences) |
| `--topics` | str | Comma-separated topic tags (e.g. "python,apis,architecture") |
| `--date` | str | Optional. Default: today's date |

## What the script does
1. Creates a new session log in `knowledge_base/sessions/YYYY-MM-DD_<slug>.md`
2. Uses Gemini to extract structured learnings from the session summary
3. For each topic tag: updates existing topic file or creates a new one
4. Appends a new row to the session table in `knowledge_base/INDEX.md`

## Output structure
```
knowledge_base/
  INDEX.md              ← Updated with new session row
  sessions/
    YYYY-MM-DD_slug.md  ← New session log
  topics/
    <domain>/
      <topic>.md        ← Created or updated with new learnings
```

## Rules for topic files
- **Update in place** — never create a duplicate topic file
- **Evergreen** — topic files are cumulative. New learnings are appended, not replaced.
- **Linked** — always add "Related" links between connected topics
- **Tagged** — every file has a `Tags:` line at the top

## Rules for session files
- One per conversation
- Captures: what was discussed, what was built, key decisions, learnings, open questions
- Never updated after creation (it's a historical record)

## KB structure by domain
```
topics/
  architecture/    ← System design, patterns, layers
  tools/           ← External tools, APIs, SDKs
  python/          ← Scripting patterns, error handling
  setup/           ← Environment, directories, config
  documentation/   ← Knowledge docs, KB management itself
  <new-domain>/    ← Created as needed
```

## Portability rules
- Pure Markdown only — no YAML front matter that breaks plain text readers
- No images inside KB files — link to `docs/knowledge/` for visuals
- Relative links between KB files — so the KB is self-contained and movable
- Keep files under ~200 lines — split if growing too large

## How to plug into external AI tools
- **Claude**: paste `INDEX.md` + relevant topic files in system prompt or first message
- **ChatGPT/Gemini**: same — paste as context before your question
- **Cursor/Copilot**: add `knowledge_base/` to workspace; it will index automatically
- **Obsidian**: open `knowledge_base/` as a vault — links work natively
- **Full dump**: `find knowledge_base -name "*.md" | xargs cat` gives everything

## Learnings log
- 2026-03-27: Initial KB created. Structure: INDEX + topics/ + sessions/.
- 2026-03-28: `update_knowledge_base.py` uses Gemini for text extraction. Free tier limit is 20 req/day for gemini-2.5-flash. With 8 topics per session, this is exhausted in 3 sessions. **Fix:** Switch `generate_knowledge_doc.py` to Claude API (claude-haiku-4-5). Keep `update_knowledge_base.py` on Gemini since it uses fewer calls (1 extraction call, then writes). If Gemini quota exhausted, KB session log and topic files must be written manually.
- 2026-03-28: `generate_knowledge_doc.py` migrated from Gemini to Claude API. Model: claude-haiku-4-5. Explicit dotenv path used: `Path(__file__).resolve().parent.parent / '.env'`.
