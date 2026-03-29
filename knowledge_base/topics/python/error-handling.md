# Error Handling & Retry Patterns

**Tags:** python, error-handling, retry, rate-limits, resilience
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## Rate limit retry (simple)
```python
import time

def call_with_retry(fn, *args, retries=3, **kwargs):
    for attempt in range(1, retries + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            if "RESOURCE_EXHAUSTED" in str(e) or "429" in str(e):
                wait = 10 * attempt   # linear backoff: 10s, 20s, 30s
                print(f"Rate limit. Waiting {wait}s (attempt {attempt}/{retries})...")
                time.sleep(wait)
            else:
                raise   # re-raise non-rate-limit errors immediately
    raise RuntimeError(f"Failed after {retries} retries")
```

## Exponential backoff (more robust)
```python
import time, random

def exponential_backoff(attempt: int, base: float = 2.0, jitter: bool = True) -> float:
    wait = base ** attempt          # 2, 4, 8, 16...
    if jitter:
        wait += random.uniform(0, 1)  # avoid thundering herd
    return min(wait, 60)            # cap at 60s

for attempt in range(5):
    try:
        result = api_call()
        break
    except RateLimitError:
        time.sleep(exponential_backoff(attempt))
```

## Fail loudly pattern
```python
# Always fail with context, not just the raw exception
try:
    result = api.call(data)
except Exception as e:
    print(f"ERROR calling API with data={data}: {e}")
    sys.exit(1)
```

## Common API errors reference
| Error | Meaning | Fix |
|-------|---------|-----|
| `429` / `RESOURCE_EXHAUSTED` | Rate limit | Retry with backoff |
| `400` / `INVALID_ARGUMENT` | Bad input | Fix the input, don't retry |
| `401` / `403` | Auth failure | Check API key in `.env` |
| `500` / `503` | Server error | Retry with backoff (transient) |
| `404` | Wrong endpoint/ID | Fix the URL/ID, don't retry |

## Rule of thumb
- **Retry**: rate limits (429), server errors (5xx), timeouts
- **Don't retry**: bad input (400), auth errors (401/403), not found (404)

## Related
- [Script Patterns](script-patterns.md)
- [Self-Annealing Loop](../architecture/self-annealing.md)
