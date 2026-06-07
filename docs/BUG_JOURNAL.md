# Bug Journal — BenchmarkWatcher

## Patterns to scan for FIRST

- **Mobile won't bundle · "Tailwind CSS has not been configured with the NativeWind preset"** → `mobile/tailwind.config.js` MUST include `presets: [require("nativewind/preset")]` (NativeWind v4). Correct `babel.config.js` + `metro.config.js` + `global.css` is **not** enough. Tests/typecheck pass without it; only a real bundle/render catches it.
- **pytest "No module named pytest"** → run `venv/bin/python -m pytest tests`, NOT the Homebrew `python3` (3.14) which has no pytest. A false-failure trap — the suite is actually green (68 passed).
- **Mobile shows "Server error (500)" but the same URL curls 200 locally** → the app reads `EXPO_PUBLIC_API_URL` from `mobile/.env` (prod = `https://benchmarkwatcher.online`) and ignores localhost. To test against local Flask, point `mobile/.env` at `http://localhost:5002`, rebuild with `--clear`, then revert `.env`. An inline `EXPO_PUBLIC_API_URL=...` does NOT win over the `.env` file.
- **zsh does not word-split unquoted `$VAR`** → `perl ... $FILES` passes the whole newline-joined list as ONE filename ("Can't open …: No such file"). Use `find … -exec perl -pi -e '…' {} +` for codemods.
- **Web styling missing locally** → `app/static/css/tailwind.css` is committed empty (0 bytes) and built by `npm run build:css` (CI/deploy). Rebuild after editing tokens in `tailwind.web.config.js` / `base.html`.
- **Alternate view modes silently broken** → a passing DEFAULT view does NOT mean alternate modes work. The grid has 3 card styles (Full / Minimal / Dense) × 2 views (grid / compact) × 7 themes, all client-rendered by imperative DOM surgery in `grid_view.js` / `compact_table.js` that depends on hook classes (`bw-grid-category-row`, `bw-grid-change-pct`, …). A `className` reassignment in ONE reset path silently breaks the others. ALWAYS screenshot every card style + view (+ a dark theme), not just the default.
- **Flask template edits need a server restart to show** → the dev server runs debug-off (no Jinja auto-reload). Static JS/CSS re-fetch on a browser reload, but `.html` template changes only appear after restarting `run.py`. Verify with `curl` against the server (definitive), not the cache-prone preview browser.
- **A fix is live on the server but the browser still shows the bug** → check BOTH: (1) a CLIENT re-render pass (`compact_table.js applyVisualSettings`, `grid_view.js updateGridSettings`) reads a raw `data-*` attribute and overwrites the server-correct value — fix the re-render path, not just the template/initial render; (2) no static cache-busting → the browser runs stale JS. ALWAYS verify by reading the **rendered DOM** (`querySelectorAll` → check `textContent`), never `curl`/unit-tests alone. Static URLs now carry `?v=<mtime>` (see `app/__init__.py _versioned_url_for`).

## Chronological log (newest first)

### 2026-06-07 · Compact-table raw floats survived "fixed" server + green tests
- Symptom: compact Chg showed `+33.667699999999996` in the browser even though `curl` returned `+33.668` and jest/pytest were green. I wrongly reported it fixed twice.
- Cause: `compact_table.js applyVisualSettings` re-renders `.chg-value` from the raw `data-value` attr (`'+' + rawValue`), overwriting the rounded initial render. Compounded by zero static cache-busting → the browser also ran stale JS.
- Fix: round in `applyVisualSettings` (`toFixed(4)`); add `?v=<mtime>` cache-busting (`app/__init__.py _versioned_url_for`). Verified in the live rendered DOM (0 raw floats across detail / grid×3 / compact).
- Lesson: see the pattern above — verify the RENDERED DOM, not the server output.

### 2026-06-07 · Grid Minimal/Dense overlap + lost up/down color + raw floats
- Symptom: Minimal Row card style overlapped the direction badge onto the commodity name ("38.Bananas"); Minimal/Dense % rendered neutral instead of teal/claret; compact-table Chg showed raw floats (`+33.667699999999996`).
- Cause: `grid_view.js` 'card' reset (line ~1017) reassigned the category-row `className` WITHOUT the `bw-grid-category-row` hook → Minimal/Dense (which queried only that class, no fallback) couldn't hide the row, so its `justify-between` content overflowed into the title column. Color: the Minimal/Dense `cssText` override wiped the inline `color: var(--color-up/down)`. Floats: `compact_table.html` chg-value + `compact_table.js` rendered raw `commodity.change` (the grid path uses `round(3)`; compact didn't).
- Fix: preserve `bw-grid-category-row` in the card reset + add the `|| div:nth-child(2)` fallback to Minimal/Dense (which the card path already had); re-apply up/down color from `data-change-pct`; round compact change (`round(3)` in template, `toFixed` in JS).
- Lesson: see the "Alternate view modes silently broken" pattern above — the default view looking fine hid three bugs in the non-default modes.

### 2026-06-07 · Mobile app could not bundle (NativeWind preset missing)
- Symptom: `expo start` → Metro config load fails: "Tailwind CSS has not been configured with the NativeWind preset".
- Cause: `mobile/tailwind.config.js` lacked `presets: [require("nativewind/preset")]` (pre-existing; babel/metro/global.css were all correct).
- Fix: added the preset line → app bundles (1464 modules) and renders on iOS Simulator.
- Lesson: NativeWind v4 needs the preset in the Tailwind config specifically; jest + tsc are blind to it — verify with a real render.
