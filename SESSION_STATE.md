# Session State

**Goal:** Level up ALL UI (web + mobile) on the FT-editorial concept, then keep
fixing real defects autonomously ("keep going"). All work landed + pushed.

**Where things stand:** `origin/main` @ `2629694` (pushed, working tree clean).

## Verification — comprehensively GREEN
- **Web:** `check:vocab` ✓ · `jest` 147 ✓ · `pytest` 69 ✓ · **`e2e` 14/14 ✓**
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

## Open / needs the user (cannot do from here)
- **Production may be down.** Earlier this session prod returned a host-500
  (Passenger could not boot the app; the code boots fine locally). Could NOT
  re-verify this turn — external network egress is blocked from this environment.
  Likely cause: prod virtualenv deps not installed. Recovery: in cPanel, reinstall
  `requirements.txt` into the app's Python venv and restart the app
  (or `touch tmp/restart.txt`); then read `passenger_boot_error.log` (added to
  `passenger_wsgi.py`) for the exact boot traceback if it still 500s.
- **Mobile visual QA** of the latest changes needs the Expo simulator.

**Headline:** Code-level defect surface is exhaustively verified clean (incl. the
strongest signal, e2e). No invented work remaining — the next real lever is the
production deploy, which needs server access.
