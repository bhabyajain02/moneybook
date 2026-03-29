# Three-Layer Architecture

**Tags:** architecture, system-design, orchestration
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## What it is
A pattern that separates AI-driven work into 3 distinct layers to maximize reliability.

```
Layer 1: Directive  →  Layer 2: Orchestration (AI)  →  Layer 3: Execution (Python)
  (What to do)           (Decision making)               (Deterministic work)
```

## Why it works
LLMs are probabilistic. Business logic is deterministic. Mixing them causes compounding errors.
- 90% accuracy per step = 59% success over 5 steps
- Fix: push complexity into deterministic scripts. AI only makes decisions.

## Layer Details

### Layer 1 — Directives (`directives/`)
- Markdown SOPs (Standard Operating Procedures)
- Define: goal, inputs, which script to run, expected outputs, edge cases
- Living documents — updated as the system learns
- Written in natural language, like instructions to a mid-level employee

### Layer 2 — Orchestration (Claude / AI)
- Reads directives to understand what to do
- Decides which scripts to run and in what order
- Handles errors, asks for clarification
- Updates directives when new patterns are discovered
- Does NOT do execution work itself

### Layer 3 — Execution (`execution/`)
- Deterministic Python scripts
- Handle: API calls, file I/O, data processing, database ops
- Reliable, testable, well-commented
- Should work identically every time given the same input

## File Layout
```
project/
  directives/   ← Layer 1: SOPs
  execution/    ← Layer 3: Python scripts
  .env          ← API keys and secrets
  .tmp/         ← Intermediate files (never commit)
```

## When to update directives
- Hit an API rate limit → document it
- Found a better approach → document it
- Script failed in a new way → document the error and fix
- Timing expectations changed → update

## Related
- [Self-Annealing Loop](self-annealing.md)
- [Directory Conventions](../setup/directory-conventions.md)
