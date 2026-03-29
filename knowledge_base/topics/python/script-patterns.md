# Python Script Patterns

**Tags:** python, scripting, patterns, execution-layer
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## Standard script structure
Every `execution/` script follows this pattern:

```python
"""
script_name.py
--------------
One-line description of what it does.

Usage:
    python execution/script_name.py --arg1 value --arg2 value

Requirements:
    pip install package1 package2
"""

import argparse
import os
import sys
from dotenv import load_dotenv

# Load env vars first
load_dotenv()
API_KEY = os.getenv("SOME_API_KEY")
if not API_KEY:
    print("ERROR: SOME_API_KEY not found in .env")
    sys.exit(1)

# Try importing optional deps — fail clearly
try:
    import some_package
except ImportError:
    print("ERROR: some_package not installed. Run: pip install some_package")
    sys.exit(1)

# Core logic as importable functions (not just __main__)
def do_thing(input: str) -> str:
    pass

# CLI entry point
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--arg1", required=True)
    args = parser.parse_args()
    result = do_thing(args.arg1)
```

## Key conventions
1. **Load `.env` at top** — always use `python-dotenv`
2. **Fail loudly on missing deps/keys** — print a clear error and `sys.exit(1)`
3. **Core logic as functions** — so other scripts can `import` them
4. **`argparse` for CLI** — not `sys.argv` directly
5. **Create output dirs automatically** — `Path(output).parent.mkdir(parents=True, exist_ok=True)`
6. **Print progress** — user should see what's happening
7. **Return meaningful exit codes** — `sys.exit(0)` on success, `sys.exit(1)` on failure

## Intermediate file pattern
```python
from pathlib import Path
TMP = Path(".tmp")
TMP.mkdir(exist_ok=True)
output = TMP / "result.json"
```

## Related
- [Error Handling](error-handling.md)
- [Directory Conventions](../setup/directory-conventions.md)
