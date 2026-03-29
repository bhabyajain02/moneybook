# Directory Conventions

**Tags:** setup, structure, organization
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## Project root layout
```
project/
  .env                    ← API keys and secrets (never commit)
  .gitignore              ← Always excludes .env, .tmp/, __pycache__
  CLAUDE.md               ← AI agent instructions (mirrored to AGENTS.md, GEMINI.md)
  directives/             ← Layer 1: SOPs in Markdown
  execution/              ← Layer 3: Deterministic Python scripts
  .tmp/                   ← Intermediate files (always regeneratable, never commit)
  docs/
    knowledge/            ← Knowledge Docs (3-level explainers + visuals per session)
  knowledge_base/         ← Persistent KB (topics, sessions, quick-reference)
  credentials.json        ← Google OAuth (never commit)
  token.json              ← Google OAuth token (never commit)
```

## knowledge_base/ layout
```
knowledge_base/
  INDEX.md                ← Master index — start here
  topics/                 ← Topic-organized knowledge (evergreen, updated over time)
    architecture/
    tools/
    python/
    setup/
    documentation/
  sessions/               ← Per-conversation logs (chronological)
```

## docs/knowledge/ layout
```
docs/knowledge/
  YYYY-MM-DD_topic-slug/
    layman.md
    intermediate.md
    pro.md
    story.md
    visuals/
      architecture_overview.png
      step_by_step.png
      beginner_illustration.png
      error_and_fix.png
```

## Naming conventions
- Folders: `kebab-case`
- Python scripts: `snake_case.py`
- Markdown files: `kebab-case.md`
- Session folders: `YYYY-MM-DD_short-slug`

## Key principle
- `.tmp/` = scratch space. Delete anytime. Always regeneratable.
- `knowledge_base/` = permanent. Grows over time. Never delete.
- `docs/knowledge/` = session artifacts. Keep for reference.
- `directives/` = instruction set. Preserve and improve, never casually overwrite.
