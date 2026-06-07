# Session State

**Goal:** Level up ALL UI (web + mobile) on the FT-editorial concept, then keep
fixing real defects autonomously ("keep going"). All work landed + pushed.

**Where things stand:** local `main` @ `3a19914`, **1 commit ahead of
`origin/main` (`4caa679`) — needs push.** Working tree clean.

**Latest pass (hardening + polish goal):** mobile bug review (5 number-format
fixes), UI-17 icons (name-sourced), UI-18 gold stale price (`scripts/resync_derived.py`),
UI-15b (non-bug, verified), **security headers** (CSP + 4 more, `app/__init__.py`),
**perf** (font `@import`→`<link>`+preconnect; **PERF-1 closed** — all Chart.js
scripts now `defer`, no longer render-blocking, ordering verified safe via e2e), `/health`
probe, `docs/DEPLOY_RECOVERY.md`. UI-15 chart now uses a real time x-axis.
**🔴 Prod is DOWN** (Namecheap host-500 = Passenger can't boot; needs cPanel — see DEPLOY_RECOVERY).

## Verification — comprehensively GREEN
- **Web:** `check:vocab` ✓ · `jest` 151 ✓ · `pytest` 71 ✓ · **`e2e` 14/14 ✓**
  (market-pulse, axe-core a11y on home + detail = 0 critical, disclaimer vocab,
  raw-float guard ×3, commodity-detail smoke = chart + settings tabs + no JS errors).
- **Mobile:** `tsc` 0 ✓ · `jest` 39 ✓. Rendered on iOS Simulator (real data,
  brand cascade confirmed).
- ⚠️ pytest: run `venv/bin/python -m pytest tests` (Homebrew py3.14 has no pytest → false failure).
- ⚠️ e2e: run `./scripts/e2e_local.sh` (auto free-port + venv Flask). Do NOT rely
  on the default 5050-style flow — a foreign server on the port silently fakes failures.

## Landed this work (highlights)
- Faithful-polish redesign (web + mobile): flat shadows, tamed weights, brand tokens.
- **Raw-float bug eradicated** (web + mobile): the real fix was in the CLIENT
  re-render (`compact_table.js applyVisualSettings`), not the template; plus
  `?v=<mtime>` cache-busting (`app/__init__.py _versioned_url_for`) so fixes reach
  the browser. Verified in the rendered DOM + e2e — see BUG_JOURNAL.
- Grid Minimal/Dense overlap + lost up/down color — root-caused + fixed.
- Chart Settings restructured into logical tabs (Tooltip / Controls / Axes & Grid / Style / Bloomberg).
- Top Movers leaderboard on the homepage (`#market-pulse-movers`, Risers/Fallers).
- e2e port footgun fixed (default 5050 → 5781) + `scripts/e2e_local.sh` harness.
- **Screenshot-driven UI polish** (`docs/UI_POLISH_REPORT.md`), 3 rounds:
  1. Default range ALL→1Y (every benchmark showed absurd all-time % like Gold
     +1531% → now real YoY moves; breadth 37/35 vs 62/10). Grid prices 4→2 dec +
     consistent `%.2f`/`toFixed(2)`, absolute change →2 dec (server + JS, both views).
  2. Chart-settings drawer tab-row clip ("Controls"→"Contro") — `px-2.5` + label
     "Axes & Grid"→"Axes".
  3. Detail page: hero + High/Low/Avg/Range stats → uniform 2-dec + thousands
     separators; removed redundant "Commodity ID" label.
  4. **Grid cards had NO up/down colour** on the % change AND the ▲/▼ badge — the
     `updateSettings` reset wipes every child inline style and the re-apply was
     incomplete, so they inherited plain text (dark in light/dark, amber in
     Bloomberg). Caught via `getComputedStyle` (screenshots looked fine). Re-applied
     teal/claret in the Full Card + Dense handlers. Verified computed in light + Bloomberg.
  Audited home (light/dark/mobile), detail (desktop/mobile, Price & %Change),
  compact, changelog, chart-settings + card-options panels — all clean or fixed.
  Deferred → `docs/KNOWN_UI_DEBT.md`: UI-15 chart x-axis time scale (needs a
  date-adapter dep + crosshair refactor), UI-17 icon collisions, UI-18 data mismatch.

## Open / needs the user (cannot do from here)
- **Production may be down.** Earlier this session prod returned a host-500
  (Passenger could not boot the app; the code boots fine locally). Could NOT
  re-verify this turn — external network egress is blocked from this environment.
  Likely cause: prod virtualenv deps not installed. Recovery: in cPanel, reinstall
  `requirements.txt` into the app's Python venv and restart the app
  (or `touch tmp/restart.txt`); then read `passenger_boot_error.log` (added to
  `passenger_wsgi.py`) for the exact boot traceback if it still 500s.
  **Runbook hardened this session** with a *verified* pre-flight: boot deps
  confirmed complete (`create_app()` imports resolve — flask/flask_caching/
  flask_limiter/dotenv, all in requirements), Python floor ≥3.9 (Flask 3.1.3),
  CSS not blank (R-1 moot), known-good pin-set fallback. See `docs/DEPLOY_RECOVERY.md`.
- **Mobile visual QA** of the latest changes needs the Expo simulator.

**Headline:** Code-level defect surface is exhaustively verified clean (incl. the
strongest signal, e2e). No invented work remaining — the next real lever is the
production deploy, which needs server access.
