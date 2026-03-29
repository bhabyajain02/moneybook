# Nano Banana Pro — Image Generation

**Tags:** tools, image-generation, gemini, google-api
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## What it is
Community name for Google DeepMind's Gemini image generation model.
- Standard: `gemini-2.0-flash-preview-image-generation`
- Pro: `gemini-3-pro-image-preview` (complex compositions)

## Setup
```bash
pip install google-genai python-dotenv
```
```env
# .env
GOOGLE_API_KEY=your_key_here
```

## Basic usage (Python)
```python
from google import genai
from google.genai import types
import os

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

response = client.models.generate_content(
    model="gemini-2.0-flash-preview-image-generation",
    contents="A flowchart showing a 3-layer architecture. Clean, white background.",
    config=types.GenerateContentConfig(
        response_modalities=["IMAGE", "TEXT"]
    ),
)

# Extract image bytes
for part in response.candidates[0].content.parts:
    if part.inline_data is not None:
        with open("output.png", "wb") as f:
            f.write(part.inline_data.data)
```

## Script to use
`execution/generate_visuals.py` — handles all of this with error handling built in.

## Rate limits
| Tier | Limit |
|------|-------|
| Free | ~50 images/day, ~10 req/min |
| Paid | 60 req/min |

## Known errors
| Error | Cause | Fix |
|-------|-------|-----|
| `RESOURCE_EXHAUSTED` | Rate limit | `time.sleep(6)` between calls |
| `INVALID_ARGUMENT` | Bad prompt | Shorten or rephrase |
| Empty response | Prompt declined | Rephrase, avoid ambiguous content |
| `API key not valid` | Wrong key | Check `.env` |

## Prompt tips
- Be specific about style: "flat design", "white background", "labeled boxes"
- Specify audience: "suitable for a 10-year-old" vs "professional diagram"
- Short text in images only — text rendering can be imperfect
- Works well for: diagrams, flowcharts, illustrations, infographics
- Avoid: real people's faces, complex text-heavy layouts

## Pricing
- Free: ~2-3 images/day at 1K resolution
- ~$0.134 per 2K image via API
- Third-party wrappers (kie.ai etc.) can be as low as ~$0.05/image

## Related
- [Gemini Text API](gemini-text-api.md)
- [Directive](../../../directives/nanobanana.md)
- [Script](../../../execution/generate_visuals.py)
