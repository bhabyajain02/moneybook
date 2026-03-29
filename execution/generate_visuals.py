"""
generate_visuals.py
-------------------
Generates images for Knowledge Docs using Nano Banana Pro (Google Gemini image model).

Usage:
    python execution/generate_visuals.py --topic "3-layer architecture" --output_dir "docs/knowledge/2026-03-27_example/visuals"

    Or import and call generate_image() directly from other scripts.

Requirements:
    pip install google-genai python-dotenv pillow
"""

import argparse
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# Load API key from .env
load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

if not GOOGLE_API_KEY:
    print("ERROR: GOOGLE_API_KEY not found in .env")
    sys.exit(1)

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("ERROR: google-genai not installed. Run: pip install google-genai")
    sys.exit(1)

# Initialize the Gemini client
client = genai.Client(api_key=GOOGLE_API_KEY)

# Model to use for image generation
IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation"


def generate_image(prompt: str, output_path: str, retry: int = 3) -> bool:
    """
    Generate a single image from a text prompt and save it as PNG.

    Args:
        prompt:      Text description of the image to generate.
        output_path: Full file path where the PNG will be saved (e.g. visuals/step1.png).
        retry:       Number of retry attempts on rate limit errors.

    Returns:
        True if image was saved successfully, False otherwise.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, retry + 1):
        try:
            print(f"  Generating: {output_path.name} (attempt {attempt})...")

            response = client.models.generate_content(
                model=IMAGE_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"]
                ),
            )

            # Extract the image from the response parts
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    # Save the raw image bytes as PNG
                    with open(output_path, "wb") as f:
                        f.write(part.inline_data.data)
                    print(f"  Saved: {output_path}")
                    return True

            print(f"  WARNING: No image in response for '{output_path.name}'. Model may have declined prompt.")
            return False

        except Exception as e:
            error_str = str(e)
            if "RESOURCE_EXHAUSTED" in error_str or "429" in error_str:
                # Rate limit — wait and retry
                wait = 10 * attempt
                print(f"  Rate limit hit. Waiting {wait}s before retry...")
                time.sleep(wait)
            elif "INVALID_ARGUMENT" in error_str:
                print(f"  ERROR: Invalid prompt or argument — {e}")
                return False
            else:
                print(f"  ERROR on attempt {attempt}: {e}")
                if attempt == retry:
                    return False
                time.sleep(5)

    return False


def generate_knowledge_visuals(topic: str, output_dir: str) -> dict:
    """
    Generate the full set of visuals for a Knowledge Doc session.

    Produces:
        1. architecture_overview.png  — overall system/process diagram
        2. step_by_step.png           — numbered steps flowchart
        3. beginner_illustration.png  — friendly cartoon for a 10-year-old
        4. error_and_fix.png          — shows a problem → fix cycle (if relevant)

    Args:
        topic:      Short description of what was built/done (e.g. "web scraper with retry logic")
        output_dir: Directory to save all PNG files

    Returns:
        Dict mapping image name → file path (only for successfully generated images)
    """
    prompts = {
        "architecture_overview.png": (
            f"A clean, minimal technical architecture diagram for: {topic}. "
            "White background. Use labeled rectangular boxes connected by arrows. "
            "Color-code each layer: blue for input/directives, green for AI orchestration, orange for Python execution. "
            "Professional, suitable for a software engineering audience."
        ),
        "step_by_step.png": (
            f"A vertical step-by-step flowchart showing the process for: {topic}. "
            "Number each step 1 through 5. Use rounded boxes, connecting arrows, and short step labels. "
            "Clean flat design. White background. Suitable for a technical blog post."
        ),
        "beginner_illustration.png": (
            f"A friendly, colorful cartoon illustration explaining: {topic}. "
            "Use simple analogies — robots, Lego bricks, or cooking metaphors. "
            "No technical jargon in the image. Suitable for a 10-year-old child. "
            "Bright colors, simple shapes, fun and approachable style."
        ),
        "error_and_fix.png": (
            f"A before-and-after illustration showing an error being fixed in: {topic}. "
            "Left panel: red error symbol, broken gears or a confused robot. "
            "Right panel: green checkmark, smooth gears, happy robot. "
            "Clean flat design. White background. Clear visual contrast between broken and fixed states."
        ),
    }

    results = {}
    output_dir = Path(output_dir)

    print(f"\nGenerating {len(prompts)} visuals for topic: '{topic}'")
    print(f"Output directory: {output_dir}\n")

    for filename, prompt in prompts.items():
        out_path = output_dir / filename
        success = generate_image(prompt, str(out_path))
        if success:
            results[filename] = str(out_path)
        # Small delay between calls to respect rate limits
        time.sleep(3)

    print(f"\nDone. {len(results)}/{len(prompts)} images generated successfully.")
    return results


# ── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Knowledge Doc visuals using Nano Banana Pro (Gemini)")
    parser.add_argument("--topic",      required=True, help="Short description of the topic (e.g. 'web scraper with retry')")
    parser.add_argument("--output_dir", required=True, help="Directory to save generated PNG images")
    parser.add_argument("--prompt",     default=None,  help="Optional: single custom prompt (generates one image only)")
    parser.add_argument("--output",     default=None,  help="Optional: output path for single image (use with --prompt)")

    args = parser.parse_args()

    if args.prompt:
        # Single image mode
        out = args.output or str(Path(args.output_dir) / "custom.png")
        success = generate_image(args.prompt, out)
        sys.exit(0 if success else 1)
    else:
        # Full knowledge doc visuals mode
        results = generate_knowledge_visuals(args.topic, args.output_dir)
        if not results:
            print("ERROR: No images were generated.")
            sys.exit(1)
