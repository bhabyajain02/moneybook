# Gemini Text API

**Tags:** tools, text-generation, gemini, google-api, llm
**First learned:** 2026-03-27
**Last updated:** 2026-03-27

---

## Models
| Model ID | Best for |
|----------|----------|
| `gemini-2.5-flash-preview-05-20` | Fast, cheap, great for structured output |
| `gemini-2.5-pro-preview-06-05` | Complex reasoning, long context |
| `gemini-2.0-flash-preview-image-generation` | Image generation (see Nano Banana Pro) |

## Basic usage
```python
from google import genai
import os

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

response = client.models.generate_content(
    model="gemini-2.5-flash-preview-05-20",
    contents="Your prompt here",
)
print(response.text)
```

## Used in this project for
- Generating `layman.md`, `intermediate.md`, `pro.md`, `story.md` in Knowledge Docs
- Extracting learnings from session notes for Knowledge Base updates

## Tips
- For structured output (JSON, tables), explicitly ask for it in the prompt
- For long documents, `gemini-2.5-flash` is cheaper and fast enough
- Temperature can be set via `GenerateContentConfig` if you need determinism

## Related
- [Nano Banana Pro](nano-banana-pro.md) — image generation
- [Script: generate_knowledge_doc.py](../../../execution/generate_knowledge_doc.py)
