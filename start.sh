#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  echo "⚠️  No .env file found. Copy .env.example to .env and fill in your OPENAI_API_KEY."
  exit 1
fi

echo "▶  Starting PitchRoom backend on http://localhost:8000"
node --watch server.js
