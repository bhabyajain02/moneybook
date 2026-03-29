# Knowledge Doc Protocol

**Tags:** documentation, knowledge-doc, explainer, nano-banana
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## What it is
After every meaningful session, generate 4 Markdown documents that explain the same thing at 3 different levels + a unified story.

## The 4 documents
| File | Audience | Style |
|------|----------|-------|
| `layman.md` | 10-year-old | Analogies, no jargon, fun |
| `intermediate.md` | CS grad (21yo) | Technical + explained, code snippets |
| `pro.md` | Senior engineer | Dense, ADR-style, patterns named |
| `story.md` | Everyone | Narrative arc: beginner → pro |

## Generate with one command
```bash
python execution/generate_knowledge_doc.py \
  --topic "what was built" \
  --notes "summary of what happened, errors, fixes"
```

Output saved to: `docs/knowledge/YYYY-MM-DD_<slug>/`

## Visuals (Nano Banana Pro)
4 images auto-generated alongside the docs:
- `architecture_overview.png` — system diagram
- `step_by_step.png` — numbered flowchart
- `beginner_illustration.png` — cartoon for beginners
- `error_and_fix.png` — problem → fix illustration

## Story arc structure
1. **The Problem** — what were we solving? (layman framing)
2. **The Plan** — how did we think about it? (intermediate framing)
3. **The Build** — what exactly happened? (pro framing)
4. **The Lesson** — what did we learn?

## Related
- [Knowledge Base Management](knowledge-base-management.md)
- [Script: generate_knowledge_doc.py](../../../execution/generate_knowledge_doc.py)
- [Nano Banana Pro](../tools/nano-banana-pro.md)
