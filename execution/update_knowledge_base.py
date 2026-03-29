"""
update_knowledge_base.py
------------------------
Updates the persistent Knowledge Base after every conversation session.

What it does:
  1. Creates a session log in knowledge_base/sessions/
  2. Uses Gemini to extract structured learnings from session notes
  3. Updates or creates topic files in knowledge_base/topics/
  4. Appends a new row to knowledge_base/INDEX.md session table

Usage:
    python execution/update_knowledge_base.py \
        --session_summary "We built a web scraper. Hit 429 rate limit. Fixed with backoff." \
        --topics "python,apis,error-handling" \
        --date "2026-03-27"

Requirements:
    pip install google-genai python-dotenv
"""

import argparse
import os
import re
import sys
import json
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    print("ERROR: GOOGLE_API_KEY not found in .env")
    sys.exit(1)

try:
    from google import genai
except ImportError:
    print("ERROR: google-genai not installed. Run: pip install google-genai")
    sys.exit(1)

client = genai.Client(api_key=GOOGLE_API_KEY)
TEXT_MODEL = "gemini-2.5-flash"
KB_DIR = Path("knowledge_base")
TOPICS_DIR = KB_DIR / "topics"
SESSIONS_DIR = KB_DIR / "sessions"
INDEX_PATH = KB_DIR / "INDEX.md"

# ── Topic → folder mapping ────────────────────────────────────────────────────

TOPIC_DOMAIN_MAP = {
    "architecture": "architecture",
    "system-design": "architecture",
    "patterns": "architecture",
    "self-annealing": "architecture",
    "orchestration": "architecture",
    "python": "python",
    "scripting": "python",
    "error-handling": "python",
    "retry": "python",
    "backoff": "python",
    "tools": "tools",
    "apis": "tools",
    "gemini": "tools",
    "nano-banana": "tools",
    "image-generation": "tools",
    "google-api": "tools",
    "setup": "setup",
    "environment": "setup",
    "config": "setup",
    "directories": "setup",
    "documentation": "documentation",
    "knowledge-doc": "documentation",
    "knowledge-base": "documentation",
}

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:60]

def call_gemini(prompt: str) -> str:
    response = client.models.generate_content(model=TEXT_MODEL, contents=prompt)
    return response.text.strip()


# ── Step 1: Extract structured learnings from session summary ─────────────────

def extract_learnings(session_summary: str, topics: list[str], session_date: str) -> dict:
    """
    Use Gemini to extract structured learnings from a raw session summary.
    Returns a dict with: title, what_happened, decisions, learnings, open_questions, topic_updates
    """
    prompt = f"""
You are extracting structured knowledge from a session summary.

Session date: {session_date}
Topics: {', '.join(topics)}
Session summary: {session_summary}

Extract and return a JSON object with exactly these fields:
{{
  "title": "Short session title (5-8 words)",
  "what_happened": "2-3 sentence summary of what was done",
  "decisions": ["decision 1", "decision 2", ...],
  "learnings": ["key learning 1", "key learning 2", ...],
  "open_questions": ["question 1", ...],
  "topic_updates": {{
    "<topic-slug>": {{
      "domain": "<folder name: architecture|tools|python|setup|documentation|other>",
      "title": "<Topic Title>",
      "new_content": "<Markdown content to ADD to the topic file. 3-10 bullet points of new knowledge. Use ## subheadings.>"
    }}
  }}
}}

For topic_updates, include one entry per topic tag provided.
For each topic, write new_content as Markdown that would be appended to an existing knowledge file.
Focus on concrete, reusable facts — not session-specific details.
Return ONLY the JSON. No markdown fences, no explanation.
"""
    raw = call_gemini(prompt)
    # Strip markdown fences if present
    raw = re.sub(r"^```[a-z]*\n?", "", raw.strip())
    raw = re.sub(r"\n?```$", "", raw.strip())
    return json.loads(raw)


# ── Step 2: Create session log ────────────────────────────────────────────────

def create_session_log(data: dict, session_date: str, session_summary: str) -> Path:
    slug = slugify(data["title"])
    path = SESSIONS_DIR / f"{session_date}_{slug}.md"
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

    decisions_md = "\n".join(f"- {d}" for d in data.get("decisions", []))
    learnings_md = "\n".join(f"- {l}" for l in data.get("learnings", []))
    questions_md = "\n".join(f"- {q}" for q in data.get("open_questions", []))

    content = f"""# Session: {data['title']}

**Date:** {session_date}
**Status:** Complete

---

## What happened
{data['what_happened']}

## Raw notes
{session_summary}

## Key decisions
{decisions_md}

## Learnings
{learnings_md}

## Open questions
{questions_md}
"""
    path.write_text(content, encoding="utf-8")
    print(f"  Created session log: {path}")
    return path


# ── Step 3: Update topic files ────────────────────────────────────────────────

def update_topic_file(topic_slug: str, topic_data: dict, session_date: str):
    domain = topic_data.get("domain", "other")
    title = topic_data.get("title", topic_slug.replace("-", " ").title())
    new_content = topic_data.get("new_content", "")

    topic_dir = TOPICS_DIR / domain
    topic_dir.mkdir(parents=True, exist_ok=True)
    topic_path = topic_dir / f"{topic_slug}.md"

    if topic_path.exists():
        # Append new learnings under a dated section
        existing = topic_path.read_text(encoding="utf-8")
        # Update "Last updated" date
        existing = re.sub(r"\*\*Last updated:\*\* .+", f"**Last updated:** {session_date}", existing)
        addition = f"\n\n## Update — {session_date}\n{new_content}"
        topic_path.write_text(existing + addition, encoding="utf-8")
        print(f"  Updated topic: {topic_path}")
    else:
        # Create new topic file
        tags = topic_slug.replace("-", ", ")
        content = f"""# {title}

**Tags:** {tags}
**First learned:** {session_date}
**Last updated:** {session_date}

---

{new_content}
"""
        topic_path.write_text(content, encoding="utf-8")
        print(f"  Created topic: {topic_path}")


# ── Step 4: Update INDEX.md session table ─────────────────────────────────────

def update_index(data: dict, session_date: str, session_path: Path):
    if not INDEX_PATH.exists():
        print("  WARNING: INDEX.md not found. Skipping index update.")
        return

    index = INDEX_PATH.read_text(encoding="utf-8")

    # Build the new table row
    relative_path = session_path.relative_to(KB_DIR)
    learnings_preview = "; ".join(data.get("learnings", [])[:2])
    new_row = f"| {session_date} | [{data['title']}]({relative_path}) | {learnings_preview} |"

    # Insert before the last line of the session table (find the table and append)
    if "| Date | Session | Key Outcomes |" in index:
        # Find the table and append the new row after the last existing row
        lines = index.split("\n")
        insert_after = -1
        in_table = False
        for i, line in enumerate(lines):
            if "| Date | Session | Key Outcomes |" in line:
                in_table = True
            if in_table and line.startswith("|"):
                insert_after = i
            elif in_table and not line.startswith("|") and insert_after > 0:
                break

        if insert_after > 0:
            lines.insert(insert_after + 1, new_row)
            INDEX_PATH.write_text("\n".join(lines), encoding="utf-8")
            print(f"  Updated INDEX.md with new session row")
    else:
        print("  WARNING: Could not find session table in INDEX.md")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Update the Knowledge Base after a session")
    parser.add_argument("--session_summary", required=True,
                        help="What happened in this session (2-5 sentences)")
    parser.add_argument("--topics", required=True,
                        help="Comma-separated topic tags (e.g. 'python,apis,architecture')")
    parser.add_argument("--date", default=str(date.today()),
                        help="Session date (default: today)")
    args = parser.parse_args()

    topics = [t.strip().lower() for t in args.topics.split(",")]
    session_date = args.date

    print(f"\nUpdating Knowledge Base for session on {session_date}")
    print(f"Topics: {', '.join(topics)}\n")

    # Step 1: Extract structured learnings
    print("Step 1/4: Extracting learnings via Gemini...")
    try:
        data = extract_learnings(args.session_summary, topics, session_date)
    except json.JSONDecodeError as e:
        print(f"ERROR: Gemini returned invalid JSON: {e}")
        print("Tip: Try simplifying your session_summary.")
        sys.exit(1)

    # Step 2: Create session log
    print("Step 2/4: Creating session log...")
    session_path = create_session_log(data, session_date, args.session_summary)

    # Step 3: Update topic files
    print("Step 3/4: Updating topic files...")
    for topic_slug, topic_data in data.get("topic_updates", {}).items():
        update_topic_file(topic_slug, topic_data, session_date)

    # Step 4: Update INDEX.md
    print("Step 4/4: Updating INDEX.md...")
    update_index(data, session_date, session_path)

    print(f"""
Knowledge Base updated!
  Session log: {session_path}
  Topics updated: {len(data.get('topic_updates', {}))}
  Index: {INDEX_PATH}

To use this KB with any AI tool:
  cat knowledge_base/INDEX.md
  cat knowledge_base/topics/<domain>/<topic>.md
""")


if __name__ == "__main__":
    main()
