# UI Polish Report — Screenshot Audit (2026-06-07)

Method: live screenshots of the running app (localhost:5002) across **home grid
(light)**, **home grid (dark)**, **home (mobile 390px)**, **commodity detail
(gold)**, and **compact table** — desktop 1280px unless noted. Findings are
ranked by how much they hurt the product's credibility at a glance.

## Findings

| # | Pri | Screen | Issue | Fix | Status |
|---|-----|--------|-------|-----|--------|
| 1 | P0 | Home grid + compact + Market Pulse | **Default range = ALL → all-time % everywhere** (Gold +1531%, Copper +449%, Aluminum +105%). Every benchmark looks like it mooned; reads as broken. | Default range `ALL → 1Y` in `routes.py`. Validated: same rows now show +0.48% / +3.89% / +21.88% / −6.87% — real YoY moves, all 72 retained. | ✅ fixed |
| 2 | P0 | Home grid cards | **Prices render 4 decimals** (103.8429, 12986.6068, 5274.7002) — noisy, unprofessional; compact already shows 2. | `price_card.html` price `round(4) → round(2)` + match the grid JS re-render. | ✅ fixed |
| 3 | P1 | Grid + compact | **Absolute change shows 3–4 decimals** (grid +33.668, compact +33.6677). | `round(3)/toFixed(4) → 2` in grid template, compact template, and both JS renderers. | ✅ fixed |
| 4 | P1 | Commodity detail chart | **X-axis ticks at equal data-index, not equal time** → "1985 · 1995 · 2006 · 2016 · Apr 2024 · Sep 2024" compresses recent years. Time looks non-linear. | Deferred — charting change (needs a time-scale x-axis); logged in KNOWN_UI_DEBT. | ⏳ logged |
| 5 | P2 | Grid card | Percent shown twice per card (▲47.98% badge + +47.98% body). Mild redundancy; the badge is the directional glance, body is detail. | Keep — intentional glance/detail split. | — |
| 6 | P2 | Detail breadcrumb | "Commodity ID: gold" is a technical label under the category. | Deferred — minor; logged. | ⏳ logged |
| 7 | P2 | Compact row icons | 2-letter lowercase icons collide (ba = Bananas & Barley). Decorative only. | Deferred — logged. | ⏳ logged |
| 8 | data | Detail vs grid | "Latest Benchmark 4490.3 (Jan-09 daily)" vs grid "5274.70 (Feb-27 monthly)" — daily/monthly merge mismatch. | Out of UI scope — data-pipeline concern; logged for the data owner. | ⏳ logged |

## What was GOOD (no change)
- **Dark mode** — terminal-black bg, cream serif title, teal-up/claret-down preserved, strong contrast, no bugs.
- **Mobile (390px)** — header/nav fit, Market Pulse → 2×2 stats, lists/filters wrap, zero horizontal overflow.
- **Compact table** — 2-decimal prices, clean teal/claret %Chg badges, hairline rows, good rhythm.
- **Detail page** — clean line chart, sensible "+0.91% vs prev day", good controls, educational frequency card, proper disclaimer.
- Flat cards (no shadows), hairline borders, serif headings, tabular numbers — brand system holding up well.

## Fixes applied — round 1
P0 #1 (range default), P0 #2 (grid price precision), P1 #3 (absolute-change precision) — across `routes.py`, `settings.js`, `price_card.html`, `compact_table.html`, `grid_view.js`, `compact_table.js`, `index.js`. Prices upgraded to consistent 2-decimals (`%.2f` / `toFixed(2)`) matching the compact view. Verified by re-screenshot (grid + compact) + the full test gate.

## Round 2 — deeper audit (changelog, chart-settings drawer)
- **Changelog page** — audited, clean (status badges, serif headings, monospace inline code, good rhythm). No change.
- **Chart Settings drawer** — restructured tabs are well-grouped. Found + fixed: the 5-tab row overflowed the drawer so the last tab "Controls" clipped to "Contro". Reduced tab padding (`px-3 sm:px-4 → px-2.5`) AND shortened the one over-long label "Axes & Grid" → "Axes" (it now matches the other tabs' brevity; the panel still holds axis+grid settings). All 5 fit — Style / Axes / Stats / Tooltip / Controls — verified by screenshot. `commodity.html`.

- **Detail page** — fixed: the hero price rendered raw 4-decimals (`3133.9827`) and the High/Low/Average/Range stats were inconsistent (some 3-dec+commas, some 2-dec no-commas). Now uniform 2-decimals + thousands separators across hero + all four stats, matching the chart tooltip (`commodity.html`, `commodity.js`). Also dropped the redundant "Commodity ID: <slug>" label above the title (UI-16).

## Deferred (logged in `docs/KNOWN_UI_DEBT.md`)
- #4 Detail chart x-axis is a category scale (no date adapter) → time looks non-linear. Needs a Chart.js time scale + adapter dependency + crosshair refactor.
- #7 colliding 2-letter row icons. #8 daily/monthly latest-benchmark vs grid value mismatch (data pipeline).
