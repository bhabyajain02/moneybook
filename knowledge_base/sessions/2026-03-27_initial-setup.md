# Session: Initial Setup

**Date:** 2026-03-27
**Topics:** architecture, tools, documentation, setup, knowledge-base
**Status:** Complete

---

## What we discussed
Set up a complete AI agent infrastructure from scratch, including:
1. The 3-layer architecture pattern (CLAUDE.md)
2. Knowledge Doc protocol — 3-level explainers + visuals after every session
3. Nano Banana Pro (Google Gemini) integration for image generation
4. A persistent knowledge base system for all future conversations

## What was built
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Master AI agent instructions |
| `.env` | Environment variables (Google API key) |
| `.gitignore` | Protects secrets and temp files |
| `directives/nanobanana.md` | SOP for Gemini image generation |
| `execution/generate_visuals.py` | Generates 4 PNGs per session via Gemini |
| `execution/generate_knowledge_doc.py` | Master doc generator (3 levels + story + visuals) |
| `execution/update_knowledge_base.py` | Updates this KB after every session |
| `knowledge_base/` | This entire knowledge base |

## Key decisions made
- **Why 3-layer architecture?** Separates probabilistic AI decisions from deterministic code execution. Prevents compounding errors.
- **Why Markdown for KB?** Portable — works with any AI tool, any editor, no lock-in.
- **Why Gemini for image gen?** Nano Banana Pro = Google's Gemini image model. Already have API key.
- **Why generate docs at 3 levels?** Different stakeholders need different explanations. A 10-year-old, a CS grad, and a senior engineer all need different framing of the same concept.

## Learnings
- Nano Banana Pro is a community name for Google's Gemini image model (gemini-2.0-flash-preview-image-generation)
- No single authoritative site — dozens of third-party wrappers. Authoritative source: Google AI Studio
- Free tier: ~50 images/day, ~10 req/min
- Knowledge base should be topic-organized (evergreen), not just chronological

## Next steps / open questions
- Test `generate_visuals.py` end-to-end with the API key
- Test `generate_knowledge_doc.py` on a real session
- Consider adding a `directives/knowledge_base.md` directive for KB management rules
- Explore Veo 3 via Vertex AI for actual video generation when available

## Files touched
- Created: all files listed in "What was built" above
- Updated: CLAUDE.md (3 rounds of updates)
