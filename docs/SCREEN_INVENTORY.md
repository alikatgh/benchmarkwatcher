# Screen Inventory

_Phase 1 audit · 2026-06-07. Concept to KEEP: FT-style editorial commodity-benchmark reference. Goal: level up polish + cross-surface consistency, not change the idea._

## Web — Flask + Tailwind (server-rendered)

| Route | Template | Purpose | States | Status |
|---|---|---|---|---|
| `/` | `index.html` (232) | Dashboard: Market Pulse summary, Quick Find search/filter, grid⇄compact toggle | loading overlay ✓ · empty ✓ · error banner partial | Functional — visually dense |
| `/` compact | `components/compact_table.html` (532) | Dense table view of all benchmarks + inline column controls | — | Functional — dense |
| `/commodity/<id>` | `commodity.html` (1013) | Detail: title, change badge, stats bar, Chart.js chart, chart-settings modal, compare | skeleton ✓ · chart error ✓ | Functional — chart-heavy |
| `/changelog` | `changelog.html` (210) | Release changelog | n/a | Functional |
| errors | `errors/{404,429,500}.html` | Error pages (12 lines each) | — | Minimal |

**Shared web components:** `header.html` (sticky nav + scroll-hiding category strip) · `footer.html` · `price_card.html` (grid card) · `grid_view.html` (range buttons + collapsible Card Options panel + grid) · `settings_modal.html` (theme / market-color / density picker).

**Web JS** (behavior — out of visual-audit scope): `index.js`, `grid_view.js`, `compact_table.js`, `commodity.js`, `settings_modal.js`, `theme.js`, `sparkline.js`, `base.js`.

## Mobile — Expo / React Native + NativeWind

| Screen | File | Purpose | Status |
|---|---|---|---|
| Home | `screen/HomeScreen.tsx` (380) | List (card⇄compact), category + range filters, sort/search/settings modals | Functional — **off-brand palette** |
| Detail | `screen/CommodityDetailScreen.tsx` (459) | Header, data source, stats bar, SVG chart, controls, compare, chart settings | Functional — **off-brand palette** |
| Settings | `screen/SettingsScreen.tsx` (25) | Appearance + data-sync sections | Thin wrapper |
| Changelog | `screen/ChangelogScreen.tsx` (41) | Changelog list | Thin wrapper |

**Mobile primitives:** `components/ui/{Badge,Icon,IconButton,MiniSparkline}`.
**Mobile feature components:** `CommodityCard`, `CompactCommodityRow`, `CompareModal`, `SearchModal`, `SortModal`, `SVGLineChart` (628), `CommodityHeader/StatsBar/ChartSection/ChartControls`, `features/settings/*`.

## Audit verdict
**Redesign mode** (skill rule: >3 screens with cross-cutting hierarchy/brand issues). **No P0 broken-UI found** — the work is quality / consistency / polish, which matches the "looks clunky" framing. See `KNOWN_UI_DEBT.md`.
