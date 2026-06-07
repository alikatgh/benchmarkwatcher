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

## Fixes applied this pass
P0 #1 (range default), P0 #2 (grid price precision), P1 #3 (absolute-change precision) — across `routes.py`, `price_card.html`, `compact_table.html`, `grid_view.js`, `compact_table.js`. Verified by re-screenshot + the full test gate. Items 4/6/7/8 logged in `docs/KNOWN_UI_DEBT.md`.
