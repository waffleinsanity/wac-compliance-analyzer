#!/usr/bin/env bash
# Local launcher for WAC Compliance Analyzer (no cloud agent required)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"
export PYTHONUNBUFFERED=1
exec python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
