# Directive: Nano Banana Pro — Image & Video Generation

## What It Is
Nano Banana Pro is the community name for Google DeepMind's Gemini image generation model.
- Standard model: `gemini-2.0-flash-preview-image-generation`
- Pro model: `gemini-2.5-pro-preview-06-05` (text-rich, complex compositions)
- SDK: `google-genai` Python package

## When to Use
- After completing any task session → generate Knowledge Doc visuals
- When a directive or story doc needs a diagram or flowchart
- When building explainer content for beginners

## Inputs
| Parameter     | Type   | Description                                              |
|---------------|--------|----------------------------------------------------------|
| `prompt`      | str    | Text description of the image/diagram to generate        |
| `output_path` | str    | Where to save the image (e.g. `docs/knowledge/.../visuals/`) |
| `style`       | str    | Optional: "diagram", "illustration", "flowchart", "photo" |

## Outputs
- PNG images saved to the specified output path
- One image per prompt call

## Script to Use
`execution/generate_visuals.py`

## API Details
- **Auth**: `GOOGLE_API_KEY` from `.env`
- **SDK install**: `pip install google-genai`
- **Method**: `client.models.generate_content()` with `response_modalities=["IMAGE"]`
- **Rate limits**: ~10 requests/min on free tier; 60 req/min on paid
- **Image size**: Up to 1024x1024 by default; prompt can specify aspect ratio

## Example Prompts by Use Case

### Architecture diagram
```
A clean technical flowchart showing a 3-layer software architecture:
Layer 1 (Directives) → Layer 2 (Orchestration/AI) → Layer 3 (Execution/Python scripts).
Use boxes, arrows, and minimal color. White background. Label each layer clearly.
```

### Beginner illustration
```
A friendly cartoon showing a robot (AI) reading a recipe book (directives),
then asking a chef robot (Python script) to cook. Simple, colorful, suitable for a 10-year-old.
```

### Step-by-step sequence
```
Step 3 of 5: A Python script running and hitting an API rate limit error.
Show a red error message on a dark terminal screen. Clean, flat design.
```

## Video Generation
Nano Banana Pro via Google's API currently supports **image generation only**.
For video, use bundled platforms (InVideo, Higgsfield) or Veo 3 via Vertex AI.
Update this directive when video API becomes available programmatically.

## Known Constraints
- Each `generate_content` call returns one image
- Prompt quality matters: be specific about style, layout, colors, audience
- Free tier: ~50 images/day total across all projects on the same API key
- Avoid prompts with real people's faces (may be refused)
- Text rendering in images is improving but can still be imperfect — keep text short

## Error Handling
| Error                        | Fix                                                        |
|------------------------------|------------------------------------------------------------|
| `RESOURCE_EXHAUSTED`         | Hit rate limit. Add `time.sleep(6)` between calls.         |
| `INVALID_ARGUMENT`           | Prompt too long or contains disallowed content. Shorten.   |
| `API key not valid`          | Check `GOOGLE_API_KEY` in `.env`                           |
| Empty/no image in response   | Model declined prompt. Rephrase to be less ambiguous.      |

## Learnings Log
- 2026-03-27: Initial setup. Model `gemini-2.0-flash-preview-image-generation` confirmed working for diagram and illustration prompts.
