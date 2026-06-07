#!/usr/bin/env bash
#
# Run the Playwright e2e suite against a LOCAL BenchmarkWatcher instance,
# reliably, from the project root:  ./scripts/e2e_local.sh
#
# What it does:
#   - Picks a guaranteed-FREE TCP port and starts the app there.
#   - Points Playwright's webServer at ./venv's Flask (not bare `python`).
#   - Forwards any extra args to `playwright test` (e.g. a spec path / --ui).
#
# What bugs it was built to dodge (see docs/BUG_JOURNAL.md, 2026-06-07 e2e entry):
#   1. reuseExistingServer + a FIXED port → Playwright silently reuses whatever
#      foreign app is already on that port. A 'wallmarkets' server on :5050 once
#      produced 9 phantom "element not found" failures. Picking a free port each
#      run makes that class of false-failure impossible.
#   2. playwright.config.ts's default flaskCommand uses bare `python`, which on
#      this machine is Homebrew 3.14 WITHOUT Flask. The app runs in ./venv, so
#      we pin PLAYWRIGHT_FLASK_COMMAND to venv/bin/python.
#
# What it does NOT catch: anything needing a real device — the mobile React
# Native render needs the Expo simulator, not Playwright (jest + tsc are blind
# to NativeWind preset / bundle errors; verify those with a real `expo start`).
#
# Usage:
#   ./scripts/e2e_local.sh                       # all specs
#   ./scripts/e2e_local.sh tests/e2e/a11y.spec.ts
#   ./scripts/e2e_local.sh --reporter=line
#
set -euo pipefail
cd "$(dirname "$0")/.."

PY=venv/bin/python
if [ ! -x "$PY" ]; then
  echo "✗ $PY not found. Create the venv first:" >&2
  echo "    python3 -m venv venv && venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

# Ask the OS for a free ephemeral port (bind :0, read it back, release it).
PORT="$("$PY" - <<'PYEOF'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PYEOF
)"

export PLAYWRIGHT_PORT="$PORT"
export PLAYWRIGHT_FLASK_COMMAND="$PY -m flask --app run:app run --host 127.0.0.1 --port $PORT"

echo "▶ e2e on free port $PORT (venv Flask)"
exec npx playwright test "$@"
