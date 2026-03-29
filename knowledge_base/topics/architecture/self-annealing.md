# Self-Annealing Loop

**Tags:** architecture, error-handling, continuous-improvement
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## What it is
The process by which the system gets stronger every time something breaks.
Named after "annealing" in metallurgy — heating and cooling metal to remove weaknesses.

## The Loop
```
Error occurs
    ↓
Read stack trace → understand root cause
    ↓
Fix the script
    ↓
Test it works
    ↓
Update directive with what was learned
    ↓
System is now stronger than before
```

## Key principle
**Errors are not failures — they are learning opportunities.**
Every bug that gets fixed and documented makes the system more reliable for next time.

## What to capture in the directive after a fix
- What the error was (exact message if possible)
- What caused it (root cause, not just symptom)
- What the fix was
- Whether timing/rate limits were involved
- Any new edge cases discovered

## Example
```
Error: RESOURCE_EXHAUSTED (429) from Gemini API
Root cause: Sending 10 requests/min, free tier limit is 10/min with bursting
Fix: Added time.sleep(6) between calls
Better fix: Used batch endpoint instead
Directive update: Added rate limit table to directives/nanobanana.md
```

## Related
- [Three-Layer Architecture](three-layer-architecture.md)
- [Error Handling Patterns](../python/error-handling.md)
