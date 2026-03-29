"""
MoneyBook — Setup & Verification Script
========================================
Run once before starting the server:
    python execution/moneybook_setup.py

Checks:
  1. All required environment variables are present
  2. Gemini API responds correctly
  3. Twilio credentials are valid
  4. Database is created and ready
  5. Prints next steps
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

PASS = "✅"
FAIL = "❌"
WARN = "⚠️ "


def section(title: str):
    print(f"\n{'─' * 50}")
    print(f"  {title}")
    print(f"{'─' * 50}")


def check_env() -> list:
    """Verify all required .env variables are set."""
    required = {
        'GEMINI_API_KEY':          'Gemini API key (for NLP + image parsing)',
        'TWILIO_ACCOUNT_SID':      'Twilio Account SID',
        'TWILIO_AUTH_TOKEN':       'Twilio Auth Token',
        'TWILIO_WHATSAPP_NUMBER':  'Twilio WhatsApp number (whatsapp:+14155238886)',
    }
    missing = []
    for key, desc in required.items():
        val = os.getenv(key, '')
        if val and not val.startswith('your_'):
            masked = val[:6] + '*' * max(0, len(val) - 6)
            print(f"  {PASS}  {key}: {masked}")
        else:
            print(f"  {FAIL}  {key} — MISSING  ({desc})")
            missing.append(key)
    return missing


def test_gemini():
    """Send a minimal test prompt to Gemini."""
    import google.generativeai as genai
    genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
    model = genai.GenerativeModel('gemini-2.5-flash')
    result = model.generate_content('Reply with exactly: {"status":"ok"}')
    raw = result.text.strip()
    print(f"  {PASS}  Gemini response: {raw[:60]}")
    return True


def test_twilio():
    """Fetch account info to verify Twilio credentials."""
    from twilio.rest import Client
    client = Client(os.getenv('TWILIO_ACCOUNT_SID'), os.getenv('TWILIO_AUTH_TOKEN'))
    account = client.api.accounts(os.getenv('TWILIO_ACCOUNT_SID')).fetch()
    print(f"  {PASS}  Twilio account: {account.friendly_name} ({account.status})")
    return True


def init_database():
    """Create SQLite tables."""
    sys.path.insert(0, os.path.dirname(__file__))
    from moneybook_db import init_db, DB_PATH
    init_db()
    print(f"  {PASS}  Database: {DB_PATH}")
    return True


def main():
    print()
    print("╔══════════════════════════════════════════╗")
    print("║        MoneyBook — Setup Check           ║")
    print("╚══════════════════════════════════════════╝")

    # ── 1. Env vars ──────────────────────────────
    section("1. Environment Variables")
    missing = check_env()
    if missing:
        print(f"\n  {WARN} Add missing vars to your .env file and re-run.")
        print("  See: .env (template already created)")
        sys.exit(1)

    # ── 2. Gemini ────────────────────────────────
    section("2. Gemini API")
    try:
        test_gemini()
    except Exception as e:
        print(f"  {FAIL}  Gemini failed: {e}")
        print("  → Check your GEMINI_API_KEY in .env")
        sys.exit(1)

    # ── 3. Twilio ────────────────────────────────
    section("3. Twilio")
    try:
        test_twilio()
    except Exception as e:
        print(f"  {FAIL}  Twilio failed: {e}")
        print("  → Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env")
        sys.exit(1)

    # ── 4. Database ──────────────────────────────
    section("4. Database")
    try:
        init_database()
    except Exception as e:
        print(f"  {FAIL}  Database error: {e}")
        sys.exit(1)

    # ── 5. All good ──────────────────────────────
    print()
    print("╔══════════════════════════════════════════╗")
    print("║      ✅  All checks passed!              ║")
    print("╚══════════════════════════════════════════╝")
    print("""
Next Steps (run each in a separate terminal):

  Terminal 1 — Start webhook server:
    uvicorn execution.moneybook_webhook:app --reload --port 8000

  Terminal 2 — Expose to internet (required for Twilio):
    ngrok http 8000

  Terminal 3 — Start dashboard:
    streamlit run execution/moneybook_dashboard.py

  Browser — Twilio Sandbox Setup:
    1. Go to https://console.twilio.com
    2. Messaging → Try it out → Send a WhatsApp message
    3. Sandbox → Sandbox settings
    4. Set "When a message comes in" to:
         https://<your-ngrok-id>.ngrok-free.app/whatsapp
    5. Save

  WhatsApp — Test:
    Send the Twilio sandbox join code to +1 415 523 8886
    (shown in Twilio console)
    Then send any message — MoneyBook will respond!
""")


if __name__ == '__main__':
    main()
