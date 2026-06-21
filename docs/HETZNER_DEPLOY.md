# Hetzner + Cloudflare Deploy Playbook — benchmarkwatcher.online

Move BenchmarkWatcher off Namecheap shared hosting (Passenger) onto a Hetzner
VPS running **gunicorn + systemd behind Caddy**, with **Cloudflare** in front for
DNS/CDN/SSL. This is the migration that actually fixes "the site isn't always
available" — see *Why this fixes the outages* at the bottom.

The same box hosts the rest of the fleet (the `sciencebo.uk` apps) — one €5
plan, not one per app. See *Adding sibling apps*.

```
            Cloudflare (DNS + CDN + WAF, orange-cloud)
                         │  Full (strict) TLS
                         ▼
   Hetzner VPS ──► Caddy :443 ──► /static/*  → served off disk
                         └──────► everything → gunicorn 127.0.0.1:8001
                                               (systemd: benchmarkwatcher.service)
   data/  ← daily systemd timer (fetch_daily_data.py)   tmp/flask_cache/ on disk
```

Repo artifacts this playbook uses: [`gunicorn.conf.py`](../gunicorn.conf.py),
[`deploy/`](../deploy), [`scripts/deploy_hetzner.sh`](../scripts/deploy_hetzner.sh),
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

> ⚠️ **The data is NOT in git.** `data/*.json` is gitignored ([.gitignore:41](../.gitignore))
> — a `git clone` gives you an **empty** `data/`. You must seed it once (Step 4)
> and let the fetch timer keep it fresh (Step 6). Skipping this = a site that
> boots fine but shows no commodities.

---

## 0. Provision the box (one-time, ~5 min)

1. Hetzner Cloud Console → create a server: **CX22** (Intel, 2 vCPU / 4 GB) or
   **CAX11** (ARM, cheaper) — either is fine; ARM is fine for pure-Python Flask.
   Image: **Ubuntu 24.04**. Add your SSH key.
2. Note the public IPv4 — call it `<SERVER_IP>`.

```bash
ssh root@<SERVER_IP>

# Non-root deploy user + the runtime
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

apt update && apt install -y python3-venv python3-pip git curl

# Caddy (reverse proxy + TLS)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Firewall — only SSH + web. (Cloudflare reaches :443; keep :80 for redirects.)
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

> **Lock origin to Cloudflare (recommended, do after Step 7 works):** once
> traffic flows through Cloudflare, restrict :80/:443 to Cloudflare's IP ranges
> so nobody can hit the origin directly and bypass the WAF. Pull the ranges from
> `https://www.cloudflare.com/ips/` and replace the blanket allow-80/443 with
> per-range `ufw allow from <range> to any port 443`.

---

## 1. Get the code

```bash
sudo -iu deploy        # become the deploy user
git clone https://github.com/<owner>/benchmarkwatcher.git ~/benchmarkwatcher
cd ~/benchmarkwatcher
```

## 2. Virtualenv + dependencies

```bash
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt    # now includes gunicorn
```

## 3. Configure `.env`

`.env` is gitignored — create it on the box (copy values from the current
Namecheap `.env`, or from `.env.example`):

```bash
cp .env.example .env
nano .env   # set FRED/EIA/USDA API keys, INTERNAL_API_KEY, SECRET_KEY, rate limits
```

Generate a stable `SECRET_KEY` (otherwise it's randomised per boot, logging
users out on every restart):

```bash
echo "SECRET_KEY=$(venv/bin/python -c 'import secrets; print(secrets.token_hex(32))')" >> .env
```

## 4. Seed the data directory (the gitignored part)

Pick whichever source you have access to. From your **local machine** (where a
populated `data/` already exists) is simplest:

```bash
# from your laptop, in the repo root:
rsync -avz --include='*.json' --exclude='*' data/ deploy@<SERVER_IP>:~/benchmarkwatcher/data/
```

Or pull straight from the **old Namecheap host** (cPanel SSH, port 21098):

```bash
rsync -avz -e 'ssh -p 21098' \
  alikvdct@server111.web-hosting.com:~/benchmarkwatcher/data/ \
  ~/benchmarkwatcher/data/
```

Or, if you have the API keys and would rather regenerate from scratch:

```bash
venv/bin/python scripts/fetch_daily_data.py
```

Sanity check: `ls ~/benchmarkwatcher/data/*.json | wc -l` should be ~70+.

## 5. Install the app service

```bash
exit   # back to root (or use sudo)
cp /home/deploy/benchmarkwatcher/deploy/benchmarkwatcher.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now benchmarkwatcher

# Let the deploy user restart it without a password (used by the deploy script)
cat >/etc/sudoers.d/benchmarkwatcher <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart benchmarkwatcher
EOF

# Verify the app answers locally (before any DNS/proxy):
curl -sI http://127.0.0.1:8001/health    # expect HTTP/1.1 200
journalctl -u benchmarkwatcher -n 30 --no-pager   # if not 200, the traceback is here
```

## 6. Install the daily data fetch timer

```bash
cp /home/deploy/benchmarkwatcher/deploy/benchmarkwatcher-fetch.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now benchmarkwatcher-fetch.timer
systemctl list-timers benchmarkwatcher-fetch   # confirm next run
systemctl start benchmarkwatcher-fetch.service  # optional: run once now
```

## 7. Caddy + TLS (behind Cloudflare)

**Issue a Cloudflare Origin certificate** (most reliable TLS when proxied):
Cloudflare dashboard → SSL/TLS → **Origin Server** → *Create Certificate*
(default: covers `benchmarkwatcher.online` + `*.benchmarkwatcher.online`, 15 yr).
Save the two PEM blocks onto the box:

```bash
mkdir -p /etc/caddy/cf-origin
nano /etc/caddy/cf-origin/benchmarkwatcher.crt   # paste the certificate
nano /etc/caddy/cf-origin/benchmarkwatcher.key   # paste the private key
chmod 600 /etc/caddy/cf-origin/benchmarkwatcher.key

cp /home/deploy/benchmarkwatcher/deploy/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

> Prefer Let's Encrypt? Delete the `tls` line in the Caddyfile, **grey-cloud**
> the DNS record (Step 8) for the first issuance so Caddy's ACME challenge
> reaches the box, then re-enable the orange cloud.

## 8. Cloudflare DNS cutover

In the Cloudflare dashboard for `benchmarkwatcher.online`:

1. **DNS → Records:** point the apex (and `www` if used) at the box:
   - `A  @   <SERVER_IP>  Proxied (orange cloud)`
   - `A  www <SERVER_IP>  Proxied`  (or a CNAME to `@`)
   - **Lower the TTL to ~2 min a few hours *before* cutover** so you can roll
     back fast.
2. **SSL/TLS → Overview → Full (strict)** (matches the Origin cert from Step 7).
3. **Caching:** static assets are already on a long `?v=<mtime>` cache-bust, so a
   default cache rule is safe. Optionally add a cache rule for `/static/*`
   (Edge TTL a month) to lean on Cloudflare's CDN.
4. If the domain still uses **Namecheap nameservers**, switch the domain to
   **Cloudflare's nameservers** (Cloudflare shows the two assigned ones) in the
   Namecheap dashboard → *Domain → Nameservers → Custom DNS*. Propagation is
   usually minutes to a couple of hours.

**Verify the cutover:**

```bash
curl -sI https://benchmarkwatcher.online/health | head -1   # HTTP/2 200
curl -s  https://benchmarkwatcher.online/health             # JSON ok
# Confirm Cloudflare is in front (expect a cf-ray / server: cloudflare header):
curl -sI https://benchmarkwatcher.online/ | grep -i 'cf-ray\|server'
```

## 9. Monitoring (so the next outage pages you, not lurks for months)

Point any uptime monitor (UptimeRobot free tier works) at
`https://benchmarkwatcher.online/health`, 1–5 min interval, alert on non-200.
This is the gap that let the last Namecheap outage run for months unnoticed.

---

## Rollback (if anything looks wrong post-cutover)

DNS-level, fastest: in Cloudflare, point the `A` records back at the **old
Namecheap host IP** (or restore Namecheap nameservers). Because you lowered TTL
in Step 8, this propagates in ~minutes. The old Namecheap app is untouched by
this migration, so it's a live fallback until you decommission it.

## Ongoing deploys

- **Manual / on the box:** `cd ~/benchmarkwatcher && ./scripts/deploy_hetzner.sh`
  (pulls, reinstalls deps only if `requirements.txt` changed, restarts,
  health-gates).
- **Automatic (push-to-deploy):** set the four `HETZNER_*` repo secrets, then
  every merge to `main` deploys itself (see
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)). Use a
  **dedicated deploy keypair**, not your personal key:

  ```bash
  # on your laptop: make a dedicated CI deploy key
  ssh-keygen -t ed25519 -f ~/.ssh/bw_deploy_ci -N "" -C "github-actions-deploy"

  # authorise its public half on the box (one time)
  ssh-copy-id -i ~/.ssh/bw_deploy_ci.pub deploy@<SERVER_IP>

  # store the secrets (run from the repo checkout)
  gh secret set HETZNER_HOST     --body "<SERVER_IP>"
  gh secret set HETZNER_USER     --body "deploy"
  gh secret set HETZNER_SSH_PORT --body "22"
  gh secret set HETZNER_SSH_KEY  < ~/.ssh/bw_deploy_ci   # the PRIVATE key
  ```

  Until these are set, the workflow runs green and no-ops (it guards on
  `HETZNER_HOST`), so it's safe to have merged already.

## Adding sibling apps (the rest of the €5 box)

Per app: clone it, give it its **own loopback port** (8002, 8003, …) and its own
`*.service`, then add a Caddy block (uncomment the template at the bottom of
[`deploy/Caddyfile`](../deploy/Caddyfile)) and `systemctl reload caddy`. Set
`MemoryMax=` on each service so one misbehaving app can't OOM-kill the others —
the per-app resource control Namecheap shared hosting never gave you.

**Suggested port map for the current fleet** (apps from
`docs/NAMECHEAP_DEPLOY.md`; confirm each unknown type on the old host with
`grep -o 'PassengerAppType \w*' ~/<app>/.htaccess`):

| App dir | Domain | Port | Type |
|---|---|---|---|
| `benchmarkwatcher` | benchmarkwatcher.online | 8001 | Flask/gunicorn ✓ (this guide) |
| `llms.sciencebo.uk` | llms.sciencebo.uk | 8002 | Node/Express |
| `api.sciencebo.uk` | api.sciencebo.uk | 8003 | confirm |
| `aulenor.sciencebo.uk` | aulenor.sciencebo.uk | 8004 | confirm |
| `bookmarks.sciencebo.uk` | bookmarks.sciencebo.uk | 8005 | confirm |
| `sciencebo.uk` | sciencebo.uk | 8006 | confirm |
| `formulas-backend` | (domain TBD) | 8007 | confirm |

Node apps don't use gunicorn — their service `ExecStart` runs the app's own
entry (`node …` / `npm start`); the Caddy block and `MemoryMax=` pattern are
identical. Each app keeps its own deploy script in its own repo — only the
shared `/etc/caddy/Caddyfile` and the per-app `*.service` live on the box.

---

## Why this fixes the outages (maps to the documented root causes)

| Namecheap failure (see DEPLOY_RECOVERY / NAMECHEAP_DEPLOY) | Fixed here by |
|---|---|
| Intermittent 503, "Reached max children" — static routed through the tiny worker pool | Caddy serves `/static/*` off disk; gunicorn only handles app routes |
| Host-500 for months — hand-managed Passenger venv lost a dependency | `requirements.txt` reinstalled into a clean venv on deploy; capped majors; health-gated |
| Prod months-stale — pushing to `main` didn't deploy | `deploy.yml` ships every merge to `main` |
| Outage unnoticed for months | `Restart=always` auto-recovers; uptime monitor on `/health` alerts |
| One account's resource caps shared across all apps | Your own box; per-service `MemoryMax`/CPU limits you control |

`FileSystemCache` (config.py) and `memory://` rate limiting keep working as-is on
a single always-on instance. The only multi-worker nuance: `memory://` limits
count per gunicorn worker (2 here), exactly as they did across Passenger workers
— set `RATELIMIT_STORAGE_URI=redis://…` if you ever need exact global limits.
