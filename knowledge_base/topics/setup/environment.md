# Environment Setup

**Tags:** setup, env, secrets, dependencies
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## .env file
```env
# Google AI Studio / Gemini API
GOOGLE_API_KEY=your_key_here

# Add other keys as needed
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
```

Load in every script:
```python
from dotenv import load_dotenv
import os
load_dotenv()
KEY = os.getenv("GOOGLE_API_KEY")
```

## .gitignore (always include)
```
.env
credentials.json
token.json
.tmp/
__pycache__/
*.pyc
.venv/
```

## Python dependencies (install once)
```bash
pip install google-genai python-dotenv pillow
```

## API Keys in this project
| Key | Service | Where to get |
|-----|---------|-------------|
| `GOOGLE_API_KEY` | Gemini API (text + images) | aistudio.google.com |

## Security rule
**Never commit `.env`.** If an API key appears in a conversation or commit, rotate it immediately at the provider's console.

## Related
- [Directory Conventions](directory-conventions.md)
