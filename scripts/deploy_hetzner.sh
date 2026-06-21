#!/usr/bin/env bash
# Deploy BenchmarkWatcher on a Hetzner/VPS host (gunicorn + systemd).
#
# What it catches that a bare `git pull` doesn't: it reinstalls deps ONLY when
# requirements.txt actually changed (so a normal code deploy stays fast),
# restarts the systemd service, and verifies /health returns 200 — so a boot
# failure surfaces HERE, not when a user hits a 500. This is the systemd
# equivalent of the Namecheap pull→restart recipe (docs/NAMECHEAP_DEPLOY.md).
#
# Does NOT: provision the box, migrate the data/ directory, or touch Cloudflare.
# One-time setup lives in docs/HETZNER_DEPLOY.md. Run from anywhere — it cd's to
# the app root itself.
#
# Requires: the deploy user may run `systemctl restart <service>` without a
# password. Add via:  sudo visudo -f /etc/sudoers.d/benchmarkwatcher
#   deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart benchmarkwatcher
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

SERVICE="${BENCHMARKWATCHER_SERVICE:-benchmarkwatcher}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8001/health}"
VENV="${VENV:-$APP_DIR/venv}"

echo "==> Deploying in $APP_DIR (service: $SERVICE)"

before="$(git rev-parse HEAD)"
git pull --ff-only origin main
after="$(git rev-parse HEAD)"

if ! git diff --quiet "$before" "$after" -- requirements.txt; then
	echo "==> requirements.txt changed → installing into venv"
	"$VENV/bin/pip" install -r requirements.txt
else
	echo "==> requirements.txt unchanged → skipping pip install"
fi

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

echo "==> Health check ($HEALTH_URL)"
for i in $(seq 1 10); do
	code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
	if [ "$code" = "200" ]; then
		echo "    OK — HTTP 200. Deploy complete."
		exit 0
	fi
	echo "    attempt $i: HTTP ${code:-unreachable} — retrying"
	sleep 2
done

echo "!! Health check FAILED. Inspect: journalctl -u $SERVICE -n 50 --no-pager" >&2
exit 1
