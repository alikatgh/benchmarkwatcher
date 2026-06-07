# Production Recovery Runbook — benchmarkwatcher.online

**Status (2026-06-07): PROD IS DOWN.** Every route returns the **Namecheap host
500 page** (`/systemerror/500/…`, namecheap-icon) — *not* the app's own error
page. That distinction is the whole diagnosis:

- The app boots **cleanly locally** (Flask dev server + full test gate green),
  so the code is fine. This is a **deploy-environment** failure.
- A Namecheap-branded 500 means **Passenger never runs `passenger_wsgi.py`**.
  If it *did* run it and the app failed to import, you'd instead see the app's
  own plain-text page: *"BenchmarkWatcher failed to start. See
  passenger_boot_error.log…"* (that fallback is wired up in `passenger_wsgi.py`).
- So the break is at the **cPanel Python-app / virtualenv layer**, below the code.

There is **no auto-deploy** (`.github/workflows/` only runs tests). Deployment is
manual, so pushing to `main` does **not** update prod — someone has to deploy +
restart on the host.

## Pre-flight (verified from the repo 2026-06-07 — narrows the fix)

These were checked locally so the cPanel steps below don't chase dead ends:

- **Boot deps are complete.** The web app's *only* third-party imports on the
  `create_app()` path are `flask`, `flask_caching`, `flask_limiter`,
  `python-dotenv` — all four are in `requirements.txt`. So **a clean
  `Run Pip Install` installs everything the app needs to boot.** If it *still*
  fails to boot after pip install, the cause is **not** a missing-from-requirements
  module — look at the Python version (below) or the entry point, not the deps.
- **Python floor = 3.9.** `Flask 3.1.3` declares `Requires-Python: >=3.9`. The
  cPanel app's interpreter **must be ≥ 3.9**, or pip can't even resolve Flask.
  (Code itself uses no 3.10+ syntax — no `match`, `tomllib`, or runtime `X | Y`.)
- **CSS won't ship blank.** `app/static/css/tailwind.css` is **committed with
  content (~37 KB)**, so even a deploy that skips `npm run build:css` renders
  styled — the old "ships at 0 bytes" risk (R-1) is currently moot. (It may *lag*
  the newest classes, but it is not empty.)
- **`requests` is fetcher-only** (`scripts/fetchers/_shared.py`, a cron path) —
  not on the web boot path. A booted-but-stale-data site is a fetcher/cron issue,
  separate from this outage.

## Fix it (cPanel · Namecheap shared hosting), in order

1. **cPanel → "Setup Python App"** (a.k.a. *Application Manager*).
   - Is the benchmarkwatcher app **listed and "Enabled"?**
     If it's gone/stopped → that alone causes the host 500. Recreate/enable it
     (Application root = repo dir, Application startup file = `passenger_wsgi.py`,
     Application Entry point = `application`).
   - Note the **Python version** shown — it **must be ≥ 3.9** (Flask 3.1.3
     requires it; an older interpreter makes `pip install` fail to resolve Flask
     *before* `passenger_wsgi.py` ever runs) and it must match the version the
     `venv/` was built with. A mismatch (e.g. venv built on 3.11, app set to 3.9)
     breaks the interpreter before boot.

2. **Click "Run Pip Install"** (installs `requirements.txt` into the app's
   virtualenv). **This is the single most likely fix** — a missing/half-installed
   dependency after a deploy is the classic cause.
   - SSH equivalent: `source ~/virtualenv/<app>/3.x/bin/activate && pip install -r requirements.txt`
   - **If a fresh install pulls a version that won't boot** (4 deps are unbounded
     in `requirements.txt` — Werkzeug / Flask-Caching / Flask-Limiter / MarkupSafe
     — so pip grabs *latest*), fall back to this **known-good set from the
     verified-green local venv** (pin in `requirements.txt`, re-install):
     `Flask==3.1.3 · Werkzeug==3.1.4 · Flask-Caching==2.3.1 · Flask-Limiter==4.1.1
     · python-dotenv==1.0.0 · requests==2.31.0 · python-dateutil==2.9.0.post0 ·
     MarkupSafe==3.0.3` (transitive: blinker 1.9.0, click 8.3.1, itsdangerous
     2.2.0, Jinja2 3.1.6, limits 5.8.0). Note: the `Flask-Limiter>=3.12` floor is
     a **different major** than the tested `4.1.1` — a resolver that picks 3.x
     could behave differently; pinning removes that variable.

3. **Restart the app**: cPanel "Restart" button, **or** `touch tmp/restart.txt`
   in the app root (Passenger restarts on the next request).

4. **Reload https://benchmarkwatcher.online/** and look at *which* 500 you get:
   - **App's plain-text 500** ("…See passenger_boot_error.log…") → progress!
     Passenger now runs the app but `create_app()` still fails. Open
     **`passenger_boot_error.log`** in the app root (File Manager / SSH) — it has
     the exact Python traceback (the missing module / bad env var). Fix that, restart.
   - **Still the Namecheap 500** → Passenger still isn't running the app. Re-check
     step 1 (entry file/point, enabled), the Python version, and the app's
     `.htaccess` (a stray rule can shadow Passenger).

## After it's up — verify
- **`curl https://benchmarkwatcher.online/health`** → expect `200`. This hits a
  route that returns from `create_app()` (`app/routes.py`), so a 200 confirms the
  app actually booted (not just that the host stopped 500-ing).
- Spot-check the homepage: the full UI polish from this session is now live —
  default 1Y range, clean 2-dec numbers, grid up/down colours, time-axis chart,
  and the deferred (non-render-blocking) Chart.js scripts.

## Why this keeps biting
The prod venv is hand-managed, and `requirements.txt` leaves 4 deps unbounded, so
a `Run Pip Install` can silently pull a new major version (this is how a
"dependency bump" sneaks in). After any such bump or a Python-version change on
the host, the venv must be re-synced (`Run Pip Install`) and the app restarted.
`passenger_wsgi.py` is already hardened to surface boot tracebacks — trust its
plain-text page over the host's.

(Note: `app/static/css/tailwind.css` is **committed with content** as of
2026-06-07, so it no longer ships blank — but it's still hand-built; re-run
`npm run build:css` after template class changes to keep it current.)

## Durability follow-ups (do AFTER prod is back — not during the recovery)
- **Pin the 4 unbounded deps** to the known-good set above (or add `<next-major`
  caps), so `Run Pip Install` is deterministic and a surprise major can't
  boot-break prod. Don't do this *during* the outage — changing the install
  target mid-recovery adds a variable.
- **Add a deploy step** (GitHub Action over SSH, or a host git-pull hook +
  `touch tmp/restart.txt`) so merges to `main` actually ship.
- **`/health`** already exists — point an uptime monitor at it so the next outage
  is caught automatically rather than noticed by hand.
