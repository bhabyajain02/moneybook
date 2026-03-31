#!/bin/bash
set -e

echo "📦 Installing dependencies..."
pip install anthropic fastapi "uvicorn[standard]" twilio apscheduler httpx python-dotenv python-multipart Pillow

echo ""
echo "🔫 Killing anything on port 8000..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true

echo ""
echo "🚀 Starting MoneyBook server..."
cd "$(dirname "$0")"
uvicorn execution.moneybook_webhook:app --reload --port 8000
