# Known UI Debt

_Phase 1 audit · 2026-06-07. Severity = visual-quality impact (no P0 broken-UI found). Each item notes the **cascade fix** (shared-layer change) where one edit covers many screens — per CLAUDE.md §4c, prefer these over per-file edits._

## P1 — Serious (quality / consistency)

### UI-1 · Brand split between web and mobile
Mobile renders in stock Tailwind `slate/blue/emerald/rose`; web uses the FT brand (claret/teal/oxford on paper, Georgia serif). They read as two different products.
- Where: `mobile/tailwind.config.js` (`extend:{}` empty) · `HomeScreen.tsx`, `CommodityDetailScreen.tsx`, `CompactCommodityRow.tsx` (slate/blue throughout).
- **Cascade fix:** add brand tokens + serif display to `mobile/tailwind.config.js`; swap `slate/blue/emerald/rose` → brand tokens. Market up/down already comes from `getMarketColors()`.

### UI-2 · Weight hierarchy has collapsed
**247 `font-bold` + 9 `font-extrabold`** across web templates (mobile similar). When nearly everything is bold, nothing leads the eye.
- **Cascade fix:** adopt a 3-role type convention — *display* (serif, bold), *value* (semibold, tabular-nums), *label* (medium, uppercase, muted). Set sane element defaults in `base.html`; reduce blanket `font-bold` on labels via a codemod.

### UI-3 · Redundant / clunky microcopy on the compact row
`CompactCommodityRow` renders the literal string **"▲ Direction Up"** right next to the already-colored, signed `%` change — saying the same thing three ways (arrow + word + colored number).
- Where: `mobile/components/CompactCommodityRow.tsx:93-98`.
- **Fix:** drop the "Direction {label}" text; the colored signed % already encodes direction. (Removes copy → vocab-safe.)

## P2 — Quality

### UI-4 · Micro-text overload
**129 sub-12px labels** (41×`text-[9px]`, 82×`text-[10px]`, 6×`text-[11px]`). Hard to scan; reads as busy.
- **Cascade fix:** collapse to two label sizes via tokens (`--text-2xs`, `--text-xs`) with one tracking value; codemod the arbitrary `text-[Npx]` to the tokens.

### UI-5 · Shadows vs. flat/hairline aesthetic
**18 shadow instances** (8 inline `box-shadow` + 10 `shadow-*`) plus the `--card-shadow` token. Cards float instead of sitting on hairlines.
- **Cascade fix:** set `--card-shadow: none` (or remove), drop inline `box-shadow`, lean on `--theme-border`. One token change flattens every card.

### UI-6 · Corner-radius sprawl
**9 distinct radii** in use: `rounded-lg`×118, `xl`×57, `md`×13, `full`×11, `sm`×6, `2xl`×5, `r`×1, `none`×1.
- **Cascade fix:** standardize to 3 steps — chips/controls 8px, cards 12px, pills `full`. Codemod the outliers (`md/2xl/sm`).

### UI-7 · Hover changes geometry (price card)
Grid card hover fires **5 effects at once**: `-translate-y-1` lift + gradient fade-in + border color + arrow translate + title color.
- Where: `app/templates/components/price_card.html:13-16,70`.
- **Fix:** keep border-tint (and maybe arrow) only; remove `-translate-y` and gradient. (UI rule: interactive state must not move/resize geometry.)

### UI-8 · Busy nested tiles in Market Pulse
Card-in-card: a `card-warm` panel holds four `bg-black/5` tinted sub-tiles, each bordered.
- Where: `app/templates/index.html:39-72`.
- **Fix:** flatten to hairline-separated rows; drop the inner fills.

### UI-9 · Mobile active states are off-brand
Active category = solid **black** pill (`bg-slate-900`); active range = **blue** chip (`bg-blue-100`).
- Where: `HomeScreen.tsx:226,280`.
- **Fix:** brand bg-tint + brand text, matching the web `[data-active]` convention (bg-tint + brand secondary text, no geometry change).

### UI-10 · `!important` theme-override sprawl
~150 lines of per-utility `!important` overrides hardcode the `bloomberg`/`ft` themes instead of driving them from tokens.
- Where: `app/templates/base.html:342-448`.
- **Fix (enables clean cascade):** express those themes through `--theme-*` / `--color-*` tokens like the other 5 themes; delete the `!important` blocks.

## P3 — Polish

- **UI-11 · Dashed borders** on empty/preview states (`border-dashed`×2) read as "unfinished." → solid hairline. (`index.html`, `grid_view.html`)
- **UI-12 · Double loading affordance** on mobile detail — ✅ Fixed. Removed the "Fetching latest benchmark data…" banner; the skeleton (`renderDetailsSkeleton`) is the sole initial-load affordance, and the refresh/last-updated status stays for the refresh path. `CommodityDetailScreen.tsx`.
- **UI-13 · Unicode `▲▼` arrows** vary in glyph weight vs. the SVG icon set. → a single shared arrow/icon.
- **UI-14 · Spacing rhythm** mixes `p-3/4/5/6` and ad-hoc `py/px`. → one 4/8/12/16/24 scale.

## Risks (not UI debt — verify separately)

- **R-1 · `tailwind.css` committed at 0 bytes**, relying on CI `build:css`. If any deploy path skips that step, the site ships unstyled. Confirm the deploy runs `npm run build:css`.

---

## Phase 2 — RESOLVED (2026-06-07)

Cascade-first redesign applied; verified green (vocab / web-jest / pytest / mobile-jest / mobile-tsc) and visually confirmed on web (light + dark + mobile width).

| Item | Status |
|---|---|
| UI-1 Brand split | ✅ Fixed — mobile `tailwind.config.js` re-tones slate/blue/indigo to the FT brand; hardcoded chart/spinner hexes remapped to claret/teal/oxford |
| UI-2 Weight collapse | ✅ Fixed — `font-extrabold`→`bold`; micro-label `font-bold`→`semibold` (codemod across templates **and** the JS render layer) |
| UI-3 Direction microcopy | ✅ Fixed — `CompactCommodityRow` shows the arrow only, colored by the market color |
| UI-4 Micro-text | ◑ Partial — `text-[9px]` tier removed (→10px); full tokenization deferred |
| UI-5 Shadows | ✅ Fixed — `--card-shadow: none` (all themes), `shadow-sm` removed, header inline shadow removed |
| UI-6 Radius sprawl | ✅ Fixed (web) — `rounded-2xl`→`xl`, `rounded-md`→`lg` |
| UI-7 Hover geometry | ✅ Fixed — `-translate-y` card lift removed |
| UI-9 Mobile active states | ✅ Fixed — now brand-toned via the config cascade |
| UI-11 Dashed borders | ✅ Fixed — solid hairline |
| UI-8 Busy nested tiles | ◑ Largely mooted by the flattening; no structural rework |
| UI-10 `!important` theme sprawl | ⬜ Deferred (maintainability, not visual) |
| UI-12 / UI-13 / UI-14 | ⬜ Deferred P3 polish |

**Web:** screenshotted — clean, editorial, on-brand in light + dark. **Mobile:** verified by typecheck + tests + the deterministic config cascade; not screenshotted (no Expo simulator in this environment).

## Polish audit — 2026-06-07 round 2 (screenshot-driven; see `docs/UI_POLISH_REPORT.md`)

Fixed this round: default range ALL→1Y (sensible % everywhere), grid prices 4→2 decimals + consistent `%.2f`, absolute change →2 decimals, chart-settings tab-row clip (`px-2.5`).

Still open:
- **UI-15 · Detail chart x-axis is non-linear in time** — ✅ Fixed. Switched the x-axis to a Chart.js `type: 'time'` scale via the `chartjs-adapter-date-fns` CDN (added in `commodity.html`), with `displayFormats` for auto tick formatting. Labels stay ISO date strings + `data:[values]` so the crosshair (pixel-based), `onHover` (index→labels/data), and tooltip all keep working unchanged. Verified: ticks now evenly spaced in time (1986·1992·1998·2004·2010·2016·2022 vs the old bunched index ticks); points position by date; e2e detail + a11y green (no JS errors), jest 151, pytest 69. Note: compare datasets still share the primary's labels (a separate `{x,y}` change would align cross-commodity dates — logged below).
- **UI-15b · Compare overlays align by index, not date** — ✅ Not a bug (misdiagnosed). The compare path already builds a **unified date axis** from all series and aligns each dataset via **LOCF** (`commodity.js` ~374-433: "handles daily-vs-monthly mismatches by carrying forward the last known price"). So overlays ARE date-aligned; the time-scale change (UI-15) plots those unified dates linearly. A monthly series "stepping" over a daily timeline is LOCF doing its job, not misalignment. Verified by reading the alignment code — no `{x,y}` refactor needed.
- **PERF-1 · Chart.js (~200KB) loads render-blocking in `base.html` `<head>` on every page** — ✅ Fixed. First the cheap wins (font `@import`→`<link>` + `preconnect` for fonts & jsdelivr). Then the deferred follow-up: `defer` all chart scripts in document order — base `Chart.js` (`base.html`) + the detail's `zoom`/`adapter`/`utils`/`commodity.js` (`commodity.html`) — so none is render-blocking yet sequencing is preserved. Safe because every consumer self-inits on `DOMContentLoaded` (the only inline init, `commodity.html`, is `DOMContentLoaded`-wrapped; the component scripts are non-deferred parse-time scripts that take the `readyState === 'loading'` → `DOMContentLoaded` path), and deferred scripts run after parse but before `DOMContentLoaded` in document order — so `Chart` is always defined before any `init()` and the zoom/adapter plugins always run after `Chart`. Verified: e2e 14/14 (commodity-detail smoke = chart renders + **no JS errors**, raw-float guards ×3), jest 151, pytest 71, vocab clean.
- **UI-16 · "Commodity ID: gold"** technical label in the detail breadcrumb — ✅ Fixed (removed; the id is the URL slug, and category + breadcrumb already identify the benchmark). Also fixed same round: detail hero + stats now uniform 2-dec + thousands separators (`commodity.html`, `commodity.js`).
- **UI-17 · Colliding row icons** — ◑ Improved. The web compact-row icon sliced the lowercase *id* ("in" for an agricultural Index whose id is `index_…`, "go" for gold); now uses the **name's** first two letters uppercased ("AG", "GO"), matching the mobile app and far more meaningful. The inherent 2-char collision (Bananas/Barley → "BA") is accepted — it's a tiny decorative glyph and the full name sits right beside it; a true fix would drop the glyph (the design favours no decorative icons) — deferred.
- **UI-18 · Detail "Latest Benchmark" ≠ grid value (stale top-level in data files)** — root-caused: e.g. `data/gold.json` has top-level `price 4490.3 / 2026-01-09` but `history[-1]` is `5274.70 / 2026-02-27` (history is daily all the way to Feb-27; the top-level is simply stale). The index path recomputes display from `history[-1]` (`_apply_latest_display_point` + `_set_display_change_fields_from_history`, `data_handler.py` ~387-391) → grid shows 5274. `get_commodity` (detail) **deliberately** uses the file's pre-computed values (`_hydrate_change_fields`, comment ~388-390 "no history recalculation") → detail shows the stale 4490. So the headline is older than its own chart. **Decision needed (not a safe autonomous edit):** (a) fix the fetcher to sync top-level price/date/derived-stats to `history[-1]` on write [proper, data-pipeline]; or (b) make `get_commodity` mirror the index (recompute display + change from history) — consistent, but contradicts the stated "use pre-computed metrics" design and changes financial display for every commodity with a stale file. ✅ **Fixed via (a):** `scripts/resync_derived.py` re-runs the canonical `compute_metrics()` over each file's history and rewrites price/date + `metrics`/`derived` (mirrors `fetch_daily_data.py`'s assembly; idempotent — only gold was stale). Detail now shows 5,274.70 / +1.9% / Feb-27, matching grid + chart. **Follow-up for the data owner:** have the daily fetcher run this (or recompute) after any history append so it can't recur.
- **UI-19 · Grid cards lost up/down colour on the % change (ALL themes)** — ✅ Fixed. Root cause: the **Full Card** style handler (the default) in `grid_view.js` did `changePctEl.style.cssText = ''`, wiping the template's `color: var(--color-up)`. The `%` then inherited plain text — dark in light/dark (which I'd misjudged as coloured from screenshots), amber in Bloomberg (the `!important` text override). Caught by reading the *computed* colour (`rgb(51,48,46)`, not teal). Fixed by re-applying the up/down colour from `link.dataset.changePct` (mirroring the Minimal/Dense handlers); verified teal `rgb(13,118,128)` / claret `rgb(153,15,61)` in light AND Bloomberg. (Originally logged as a Bloomberg-only issue — it was all themes.)
