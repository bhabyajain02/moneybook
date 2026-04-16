"""
generate_knowledge_doc.py
--------------------------
Master script that generates a complete Knowledge Doc for any session.

Given a topic and a raw notes/summary string, it:
  1. Writes layman.md    (for a 10-year-old)
  2. Writes intermediate.md (for a 21-year-old CS grad)
  3. Writes pro.md       (for an experienced engineer)
  4. Writes story.md     (unified beginner → pro narrative)
  5. Calls generate_visuals.py to produce 4 PNG images

Uses Anthropic Claude API for text generation (primary).
Gemini was the original backend but hit free-tier quota limits — switched to Claude.

Usage:
    python execution/generate_knowledge_doc.py \
        --topic "web scraper with retry logic" \
        --date "2026-03-27" \
        --notes "We built a Python scraper that fetches job listings. Hit a 429 rate limit. Fixed with exponential backoff. Updated directive."

Requirements:
    pip install anthropic python-dotenv
"""

import argparse
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import anthropic
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=_ENV_PATH, override=False)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    print(f"ERROR: ANTHROPIC_API_KEY not found. Checked: {_ENV_PATH}")
    sys.exit(1)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
TEXT_MODEL = "claude-haiku-4-5"   # fast + cheap for doc generation


def slugify(text: str) -> str:
    """Convert a topic string to a URL/folder-safe slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:60]


def call_claude(prompt: str) -> str:
    """Call Claude text model and return the response string."""
    resp = client.messages.create(
        model=TEXT_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def generate_layman(topic: str, notes: str) -> str:
    prompt = f"""
You are writing for a curious 10-year-old child.
Topic: {topic}
Raw notes from the session: {notes}

Write a fun, friendly Markdown document (layman.md) that explains:
1. What problem we were trying to solve (use a real-world analogy like Lego, cooking, or video games)
2. How we thought about it (simple, no jargon)
3. What we built step by step (like a story)
4. What went wrong and how we fixed it (make it exciting, like solving a puzzle)
5. What we learned at the end

Rules:
- No technical jargon. If you must use a tech word, explain it in one friendly sentence.
- Use "imagine if..." framing wherever possible.
- Short paragraphs (2-3 sentences max).
- Add a fun title and emoji section headers.
- End with: "Now you know how [topic] works!"
"""
    return call_claude(prompt)


def generate_intermediate(topic: str, notes: str) -> str:
    prompt = f"""
You are writing for a 21-year-old who just graduated with a Computer Science degree.
Topic: {topic}
Raw notes from the session: {notes}

Write a technical-but-approachable Markdown document (intermediate.md) that covers:
1. The problem and why it matters
2. The approach taken and why (mention alternatives considered)
3. Step-by-step implementation with code snippets and inline comments
4. Errors encountered, stack traces summarized, and how they were fixed
5. What the system looks like now vs before
6. Key takeaways and what you'd explore next

Rules:
- Use correct technical terms but always explain the "why" behind each decision.
- Include short code blocks where helpful.
- Mention tradeoffs (e.g. "we used X instead of Y because...").
- Tone: like a senior dev explaining to a new hire during a code review.
"""
    return call_claude(prompt)


def generate_pro(topic: str, notes: str) -> str:
    prompt = f"""
You are writing for an experienced software engineer / tech lead (5+ years).
Topic: {topic}
Raw notes from the session: {notes}

Write a dense, precise Markdown document (pro.md) covering:
1. Problem statement and constraints
2. Architecture decisions with justification (name patterns: retry-with-backoff, idempotency, etc.)
3. Implementation details: edge cases, failure modes, performance implications
4. What broke, root cause analysis, and the fix
5. What was updated in directives/scripts and why (the self-annealing loop)
6. "At scale" notes: what would change with 10x load, distributed systems, etc.
7. Open questions and next steps

Rules:
- Dense and precise. No hand-holding.
- Reference design patterns and architecture principles by name.
- Include exact error types, API limits, timing details where known.
- Tone: internal postmortem / architecture decision record (ADR).
"""
    return call_claude(prompt)


def generate_story(topic: str, notes: str, layman: str, intermediate: str, pro: str) -> str:
    prompt = f"""
You are writing a unified story document (story.md) that takes the reader on a journey from total beginner to professional understanding of the same topic.

Topic: {topic}
Raw notes: {notes}

The story must flow as ONE continuous narrative with 4 chapters:

## Chapter 1: The Problem (Beginner — 10-year-old level)
Start with a relatable analogy. Make the reader feel the problem before knowing the solution.

## Chapter 2: The Plan (Intermediate — CS grad level)
Transition into how we thought about the problem technically. What were the options? What did we choose and why?

## Chapter 3: The Build (Professional level)
Walk through exactly what happened: the code, the errors, the fixes, the iteration. Be precise.

## Chapter 4: The Lesson (Universal)
What did the system learn? What would we do differently? One key insight for each level of reader.

Rules:
- Each chapter should naturally build on the last — the reader should feel like they're "leveling up".
- Use clear chapter headings but make the prose flow naturally between them.
- End with a 3-bullet "TL;DR" summary for each audience type.
"""
    return call_claude(prompt)


def write_doc(path: Path, content: str):
    """Write content to a file, creating parent dirs as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  Written: {path}")


def main():
    parser = argparse.ArgumentParser(description="Generate a full 3-level Knowledge Doc for a session")
    parser.add_argument("--topic", required=True, help="Short topic description (e.g. 'web scraper with retry')")
    parser.add_argument("--notes", required=True, help="Raw session notes: what was done, what broke, what was fixed")
    parser.add_argument("--date",  default=str(date.today()), help="Date string for folder name (default: today)")
    parser.add_argument("--skip-visuals", action="store_true", help="Skip image generation (faster, no API image calls)")
    args = parser.parse_args()

    slug = slugify(args.topic)
    doc_dir = Path(f"docs/knowledge/{args.date}_{slug}")
    visuals_dir = doc_dir / "visuals"

    print(f"\nGenerating Knowledge Doc: {doc_dir}\n")

    # ── Generate text documents ──────────────────────────────────────────────

    print("Step 1/5: Writing layman.md...")
    layman = generate_layman(args.topic, args.notes)
    write_doc(doc_dir / "layman.md", layman)

    print("Step 2/5: Writing intermediate.md...")
    intermediate = generate_intermediate(args.topic, args.notes)
    write_doc(doc_dir / "intermediate.md", intermediate)

    print("Step 3/5: Writing pro.md...")
    pro = generate_pro(args.topic, args.notes)
    write_doc(doc_dir / "pro.md", pro)

    print("Step 4/5: Writing story.md...")
    story = generate_story(args.topic, args.notes, layman, intermediate, pro)
    write_doc(doc_dir / "story.md", story)

    # ── Generate visuals ─────────────────────────────────────────────────────

    if args.skip_visuals:
        print("\nStep 5/5: Skipping visuals (--skip-visuals flag set).")
    else:
        print("\nStep 5/5: Generating visuals via Nano Banana Pro...")
        result = subprocess.run(
            [
                sys.executable,
                "execution/generate_visuals.py",
                "--topic", args.topic,
                "--output_dir", str(visuals_dir),
            ],
            capture_output=False,  # stream output to terminal
        )
        if result.returncode != 0:
            print("  WARNING: Visual generation failed. Check errors above. Text docs are complete.")

    # ── Summary ──────────────────────────────────────────────────────────────

    print(f"""
Knowledge Doc complete!
  {doc_dir}/
  ├── layman.md          ← 10-year-old explanation
  ├── intermediate.md    ← CS grad explanation
  ├── pro.md             ← Senior engineer explanation
  ├── story.md           ← Unified beginner→pro narrative
  └── visuals/           ← Generated PNG images
""")


if __name__ == "__main__":
    main()
