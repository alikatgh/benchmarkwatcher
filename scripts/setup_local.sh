#!/usr/bin/env bash
# Fresh local/worktree setup. Does not load .env or copy private app state.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci --no-audit --no-fund
npx playwright install chromium
printf '\nReady. Preview: npm run preview:fixture\nChat regression: npm run test:chat\n'
