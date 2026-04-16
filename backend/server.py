"""
Bridge module: imports the MoneyBook FastAPI app from the execution package
so that supervisor can run it as `server:app` from /app/backend/.
"""
import sys
import os

# Add project root to path so execution package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from execution.moneybook_webhook import app  # noqa: F401
