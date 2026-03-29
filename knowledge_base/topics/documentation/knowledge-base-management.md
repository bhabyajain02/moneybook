# Knowledge Base Management

**Tags:** documentation, knowledge-base, learning, memory
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## Purpose
A portable, AI-readable personal knowledge base that grows with every conversation.
Works standalone and plugs into any AI tool (Claude, ChatGPT, Gemini, Cursor, etc.).

## Structure
```
knowledge_base/
  INDEX.md          ← Always start here
  topics/           ← Evergreen knowledge by domain
  sessions/         ← Per-conversation logs
```

## After every conversation, run
```bash
python execution/update_knowledge_base.py \
  --session_summary "what happened" \
  --topics "comma,separated,topic,tags"
```

This will:
1. Create a new session log in `sessions/`
2. Extract key learnings via Gemini
3. Update or create relevant topic files
4. Update `INDEX.md` session table

## How topic files work
- One file per distinct topic/concept
- **Evergreen** — updated in place, not duplicated
- Format: metadata header → what it is → usage → examples → related links
- If a topic doesn't exist yet, the script creates it

## How to plug into an AI tool
- **Give full context**: paste `INDEX.md` + `topics/architecture/*.md`
- **Give task context**: paste the specific topic file relevant to what you're asking
- **Give everything**: `cat knowledge_base/**/*.md` and paste the whole thing

## Portability
- Pure Markdown — no proprietary format
- No database — just files on disk
- Works in any editor, any AI tool, any version control system
- Can be exported to Notion, Obsidian, Confluence, or any wiki

## Related
- [Knowledge Doc Protocol](knowledge-doc-protocol.md)
- [Script: update_knowledge_base.py](../../../execution/update_knowledge_base.py)
