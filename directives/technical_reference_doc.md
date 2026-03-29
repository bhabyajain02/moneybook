# Directive: Complete Technical Reference Document

## Purpose
Generate a comprehensive, engineer-grade technical reference document for any product or system built in this codebase. The output should be detailed enough that a software engineer with zero prior context can fully understand, audit, extend, or rebuild the system from scratch by reading it alone.

## When to Trigger
Use this directive when:
- Finishing a product build and need complete documentation
- Onboarding a new engineer to the codebase
- Auditing the system architecture
- Planning a major refactor
- Before handing off a project

## The Prompt That Works

The exact user prompt that produced the MoneyBook 2287-line technical reference (2026-03-28):

```
I want you to share a complete doc of the product we have. The complete architecture -
which model is used, what prompts are used, the engineering architecture, the AI architecture
everything. From high level to low level design to end to end coding part. How is everything
functioning. The doc should be at least 25 pages long, not less than that. Don't miss any info.
```

## What To Do When Triggered

1. **Read every file** in `execution/` that is part of the product — all of them, fully
2. **Read all directives** in `directives/` relevant to the product
3. **Write the document** to `docs/<product_name>_complete_technical_reference.md`
4. **Minimum 2000 lines** — if shorter, sections are missing

## Mandatory Sections (26 total for MoneyBook — scale as needed)

| # | Section | What It Must Cover |
|---|---------|-------------------|
| 1 | Product Overview | What it does, who uses it, core insight, key differentiator |
| 2 | Problem Statement | Why it exists, market context, why existing solutions fail |
| 3 | High-Level Architecture | Full ASCII system diagram showing every component and data flow |
| 4 | Technology Stack | Table: component → technology → version → why chosen |
| 5 | Directory Structure | Full tree with every file and its exact responsibility |
| 6 | Environment Config | Every `.env` variable, what it does, how it's loaded, where used |
| 7 | Database Architecture | Full CREATE TABLE SQL for every table, every column explained, relationships, triggers, migration strategy |
| 8 | AI Architecture | Models used, why each model, token economics, why not alternatives |
| 9 | Parser / AI Layer Deep-Dive | Every function with full code, all prompts, parsing logic |
| 10 | Server / Orchestration Deep-Dive | Web framework, request handling, all endpoints, decision trees |
| 11 | State Machine | All states, all transitions, triggers, state persistence mechanism |
| 12 | Database Layer Deep-Dive | Every DB function with code, query patterns, connection management |
| 13 | Dashboard / UI | All components, data sources, charts |
| 14 | Scheduled Jobs | Every cron job, schedule, what it does |
| 15 | Learning / Personalization System | How the system improves per-user over time |
| 16 | Infrastructure Constraints | Platform limits, how each is handled (e.g. Twilio 1600 char limit) |
| 17 | E2E Flow: Happy Path 1 | Trace every step of the primary use case (e.g. text message) |
| 18 | E2E Flow: Happy Path 2 | Trace every step of the secondary use case (e.g. image/photo) |
| 19 | All API Calls | Exact endpoint, exact parameters, models, auth, retry logic |
| 20 | Prompt Engineering | Every prompt reproduced in full with line-by-line annotation of *why* each rule exists |
| 21 | Advanced AI Features | Extended thinking, RAG, few-shot, chain-of-thought — how implemented |
| 22 | Error Handling | Every error type, handling strategy, fallback chain |
| 23 | Bug Registry | Every known bug: symptom → root cause → exact fix with code |
| 24 | Performance | P50/P95 latency per operation, throughput limits, memory, storage |
| 25 | Deployment Guide | Step-by-step for dev and production, all commands in order |
| 26 | Open Items & Roadmap | What's not built, prioritized backlog |

## Quality Standards

**Every code snippet must be:**
- Runnable (not pseudocode)
- Include the function signature
- Show the actual logic, not just the function name

**Every prompt must be:**
- Reproduced in full (not summarized)
- Annotated with *why* each rule was added
- Include the history of what changed and why

**Every bug must include:**
- Exact symptom (what the user saw)
- Root cause (what was actually wrong in code)
- Exact fix (the diff / the changed code)

**E2E flows must include:**
- Every function call in sequence
- Every API call with actual parameter values
- Every database query
- Actual timing
- What the user sees at each step

## Example Output

See: `docs/moneybook_complete_technical_reference.md`
- 2,287 lines | 11,465 words | 26 sections
- Generated: 2026-03-28
- For: MoneyBook WhatsApp financial tracker

## Learnings

1. Reading ALL files before writing — not just the main ones — ensures nothing is missed (e.g. dashboard, setup script, scheduled jobs are easy to skip)
2. Code snippets > descriptions. Engineers want to see the actual code, not "the function parses JSON."
3. The E2E traces (Sections 17-18) are the most valuable part — they connect everything and make the system understandable as a whole
4. Prompt annotation (Section 20) is critical — without knowing *why* each rule was added, future maintainers will delete important rules thinking they're unnecessary
5. Bug registry (Section 23) prevents re-introduction of fixed bugs and documents the evolution of the system
