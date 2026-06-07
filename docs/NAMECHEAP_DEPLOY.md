# Namecheap Deploy Playbook (shared cPanel)

Every app below lives on **one** Namecheap shared-hosting cPanel account, deployed
via **git-over-SSH + Phusion Passenger**. There is **no auto-deploy** — pushing to
GitHub does *not* update production; you must pull + restart on the host. This is
the reusable recipe, and the one that brought `benchmarkwatcher.online` back from a
multi-month outage (full post-mortem in `DEPLOY_RECOVERY.md`).

## Connect (SSH)

Namecheap shared hosting uses a **non-standard SSH port (21098)**, and the cPanel
user (`alikvdct`) is **different** from the GitHub handle (`alikatgh`):

```bash
ssh <cpanel-user>@<server>.web-hosting.com -p 21098
# real example: ssh alikvdct@server111.web-hosting.com -p 21098
```

(No SSH client handy? cPanel → search **"Terminal"** for a browser shell.)

## Recipe A — Python / Flask app (Passenger)

From the app root (`~/<app-dir>`):

```bash
git pull --ff-only origin main           # deploy latest (clean tree → fast-forward)
# ONLY if requirements.txt changed — install into the venv PASSENGER uses,
# which is named in .htaccess `PassengerPython`, NOT the repo's local venv/:
"$(grep -oP 'PassengerPython "\K[^"]+' .htaccess)" -m pip install -r requirements.txt
touch tmp/restart.txt                    # Passenger reloads on the next request
curl -sI https://<domain>/ | head -1     # expect: HTTP/2 200
```

**The venv trap:** there are usually two virtualenvs — the repo's `venv/` and the
cPanel one at `~/virtualenv/<app>/<pyver>/`. Passenger boots the latter (see
`.htaccess`). Installing into the wrong one is why "I ran pip install and it's still
broken" happens.

**Static files → off the worker pool.** One symlink at the app root makes LiteSpeed
serve assets directly off disk instead of routing every CSS/JS request through the
Python app:

```bash
ln -sfn app/static static
```

Without this, a single page view fires ~10 requests at a tiny worker pool and you
get intermittent **503s** (`Reached max children process limit`). See DEPLOY_RECOVERY.md.

## Recipe B — Node / Express app (Passenger)

From the app root (`~/<app-dir>`):

```bash
git pull
npm install                              # only if package.json changed
# if a Vue/React frontend changed: (cd frontend && npm install && npm run build)
mkdir -p tmp && touch tmp/restart.txt
curl -s https://<domain>/<health-route>  # JSON / 200 = live
```

## Apps on this account (map as you confirm each)

| ~/app-dir | Type | Domain | Deploy |
|---|---|---|---|
| `benchmarkwatcher` | Flask / Passenger | benchmarkwatcher.online | A — pull + (pip only if reqs change) + restart |
| `llms.sciencebo.uk` | Node / Express | llms.sciencebo.uk | B — pull + npm install + restart (`PULL.md` in that repo) |
| `api.sciencebo.uk` | ? | api.sciencebo.uk | map: `grep PassengerAppType ~/api.sciencebo.uk/.htaccess` |
| `aulenor.sciencebo.uk` | ? | aulenor.sciencebo.uk | map |
| `bookmarks.sciencebo.uk` | ? | bookmarks.sciencebo.uk | map |
| `formulas-backend` | ? | ? | map |
| `sciencebo.uk` | ? | sciencebo.uk | map |

To classify any of the unknowns in one shot:

```bash
for d in ~/*/; do
  [ -f "$d/.htaccess" ] && printf "%-26s %s\n" "$(basename "$d")" \
    "$(grep -oP 'PassengerAppType \K\w+' "$d/.htaccess" 2>/dev/null || echo 'no-passenger')"
done
```

## Troubleshooting

- **Namecheap-branded host 500 (every route)** → Passenger isn't booting the app.
  `tail ~/<app>/stderr.log` for the real traceback — almost always a missing module
  → `pip`/`npm install` into the right environment, then `touch tmp/restart.txt`.
- **Intermittent 503 "Service Unavailable"** → LSAPI worker pool exhausted
  (`Reached max children`). Serve `/static` off disk (symlink above) so a page view
  costs 1 worker, not ~10. Last resort: raise `LSAPI_CHILDREN` (costs memory).
- **Changes don't show** → `touch tmp/restart.txt`.
