#!/usr/bin/env bash
# One-shot provisioner — takes a fresh Ubuntu 24.04 Hetzner box to
# "BenchmarkWatcher running under gunicorn + systemd, Caddy installed",
# idempotently. Re-running is safe.
#
# Run as root on the box:
#   curl -fsSL https://raw.githubusercontent.com/alikatgh/benchmarkwatcher/main/scripts/provision_hetzner.sh | sudo bash
# or scp it over and `sudo bash provision_hetzner.sh`.
#
# Automates docs/HETZNER_DEPLOY.md steps 0-2 and 5-7. It deliberately does NOT
# do the parts that need YOUR secrets/data (printed as NEXT STEPS at the end):
#   - .env API keys (FRED/EIA/USDA, INTERNAL_API_KEY)  -> you edit
#   - data/*.json (gitignored, ~2 MB)                  -> you rsync
#   - Cloudflare Origin cert + DNS cutover             -> you paste / set
#
# Tunables via env: DEPLOY_USER, APP_REPO, APP_DIR, APP_PORT.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_REPO="${APP_REPO:-https://github.com/alikatgh/benchmarkwatcher.git}"
APP_DIR="${APP_DIR:-/home/${DEPLOY_USER}/benchmarkwatcher}"
APP_PORT="${APP_PORT:-8001}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

log "Packages (python venv, git, caddy prereqs, ufw)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3-venv python3-pip git curl ufw gnupg \
	debian-keyring debian-archive-keyring apt-transport-https

if ! command -v caddy >/dev/null 2>&1; then
	log "Installing Caddy"
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
		| gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		>/etc/apt/sources.list.d/caddy-stable.list
	apt-get update -y && apt-get install -y caddy
fi

log "Firewall (SSH + 80/443)"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable

if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
	log "Creating user $DEPLOY_USER"
	adduser --disabled-password --gecos "" "$DEPLOY_USER"
	usermod -aG sudo "$DEPLOY_USER"
fi
# Let the key that can SSH root also SSH the deploy user.
if [ -f /root/.ssh/authorized_keys ]; then
	install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
	install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
		/root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

log "Code -> $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
	sudo -u "$DEPLOY_USER" git -C "$APP_DIR" pull --ff-only origin main
else
	sudo -u "$DEPLOY_USER" git clone "$APP_REPO" "$APP_DIR"
fi

log "Virtualenv + dependencies"
[ -x "$APP_DIR/venv/bin/python" ] || sudo -u "$DEPLOY_USER" python3 -m venv "$APP_DIR/venv"
sudo -u "$DEPLOY_USER" "$APP_DIR/venv/bin/pip" install --upgrade pip
sudo -u "$DEPLOY_USER" "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"

# Seed a placeholder .env so the service can boot (config.py has safe defaults;
# real API keys go in later). NEVER overwrite an existing .env.
if [ ! -f "$APP_DIR/.env" ]; then
	log "Seed placeholder .env (add real keys later)"
	sudo -u "$DEPLOY_USER" cp "$APP_DIR/.env.example" "$APP_DIR/.env"
	secret="$("$APP_DIR/venv/bin/python" -c 'import secrets; print(secrets.token_hex(32))')"
	sudo -u "$DEPLOY_USER" bash -c "echo 'SECRET_KEY=$secret' >> '$APP_DIR/.env'"
fi

log "systemd services (app + daily fetch timer)"
install -m 644 "$APP_DIR/deploy/benchmarkwatcher.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/benchmarkwatcher-fetch.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/benchmarkwatcher-fetch.timer" /etc/systemd/system/
# Let the deploy user restart the app without a password (deploy_hetzner.sh uses it).
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart benchmarkwatcher" \
	>/etc/sudoers.d/benchmarkwatcher
chmod 440 /etc/sudoers.d/benchmarkwatcher
systemctl daemon-reload
systemctl enable --now benchmarkwatcher
systemctl enable --now benchmarkwatcher-fetch.timer

log "Caddy — temporary HTTP proxy now; production (TLS) staged for after DNS+cert"
# The repo's production Caddyfile references the Cloudflare Origin cert you
# haven't placed yet, so activating it now would fail to load. Stage it, and
# serve a minimal HTTP proxy so http://<IP>/health works immediately (pre-DNS).
install -m 644 "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile.production
cat >/etc/caddy/Caddyfile <<EOF
:80 {
	encode zstd gzip
	handle_path /static/* {
		root * ${APP_DIR}/app/static
		file_server
	}
	reverse_proxy 127.0.0.1:${APP_PORT}
}
EOF
systemctl reload caddy || systemctl restart caddy

log "Smoke test"
sleep 1
app_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${APP_PORT}/health" || echo 000)"
caddy_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1/health" || echo 000)"
echo "    gunicorn 127.0.0.1:${APP_PORT}/health -> HTTP ${app_code}"
echo "    caddy    127.0.0.1:80/health         -> HTTP ${caddy_code}"

cat <<EOF

============================================================
 BenchmarkWatcher provisioned — app is running under systemd.
 REMAINING (need your input; see docs/HETZNER_DEPLOY.md):
   1. Real secrets:  nano ${APP_DIR}/.env   (FRED/EIA/USDA keys, INTERNAL_API_KEY)
   2. Seed data:     rsync your data/*.json -> ${APP_DIR}/data/  (it's gitignored)
                     then: sudo systemctl restart benchmarkwatcher
   3. Cloudflare TLS: save an Origin cert to /etc/caddy/cf-origin/, then:
                     sudo cp /etc/caddy/Caddyfile.production /etc/caddy/Caddyfile
                     sudo systemctl reload caddy
   4. DNS cutover:   point benchmarkwatcher.online A-record at this box (proxied),
                     SSL mode Full (strict).  [runbook step 8]
   5. Monitor:       point an uptime check at https://benchmarkwatcher.online/health
============================================================
EOF
