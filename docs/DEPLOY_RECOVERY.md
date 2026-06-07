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

## Fix it (cPanel · Namecheap shared hosting), in order

1. **cPanel → "Setup Python App"** (a.k.a. *Application Manager*).
   - Is the benchmarkwatcher app **listed and "Enabled"?**
     If it's gone/stopped → that alone causes the host 500. Recreate/enable it
     (Application root = repo dir, Application startup file = `passenger_wsgi.py`,
     Application Entry point = `application`).
   - Note the **Python version** shown — it must match the version the
     `venv/` was built with. A mismatch (e.g. venv built on 3.11, app set to
     3.9) breaks the interpreter before `passenger_wsgi.py` runs.

2. **Click "Run Pip Install"** (installs `requirements.txt` into the app's
   virtualenv). **This is the single most likely fix** — a missing/half-installed
   dependency after a deploy is the classic cause.
   - SSH equivalent: `source ~/virtualenv/<app>/3.x/bin/activate && pip install -r requirements.txt`

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

## After it's up
- The full UI polish from this session goes live (default 1Y range + clean
  2-dec numbers, grid up/down colours, time-axis chart, etc.).
- Consider adding a tiny **deploy step** (GitHub Action over SSH, or a host
  git-pull hook + `touch tmp/restart.txt`) so future merges actually ship.
- Optional: a `/health` route that returns 200 from `create_app()` makes future
  outages trivially detectable (curl it from CI / an uptime monitor).

## Why this keeps biting
The repo ships `app/static/css/tailwind.css` empty (built in CI), and the prod
venv is hand-managed. After any dependency bump or Python-version change on the
host, the venv must be re-synced (`Run Pip Install`) and the app restarted.
`passenger_wsgi.py` is already hardened to surface boot tracebacks — trust its
plain-text page over the host's.
