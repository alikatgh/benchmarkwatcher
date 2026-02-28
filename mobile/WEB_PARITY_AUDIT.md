# Web ↔ Mobile Parity Audit

Date: 2026-02-28

## Verdict
Mobile is **functionally parity-signed-off**, but **not strict interaction-by-interaction 1:1** with the web app.

- Core user value is mirrored (commodity list, filters, detail charts, compare, settings, changelog).
- Some web-specific behaviors are not mirrored exactly (URL/query-state behavior, certain desktop/table interactions, and specific chart interaction details).

## Feature Matrix

| Area | Web | Mobile | Status |
|---|---|---|---|
| Home list of commodities | `index.html` + grid/compact JS | `HomeScreen.tsx` list + compact row | Matched |
| View mode toggle (grid/compact) | `index.js` + settings modal | Toggle button in `HomeScreen.tsx` | Matched |
| Category filter | URL + server/client filter | Local state filter chips | Matched |
| Data range selector | Grid/table range controls | Range controls on home/detail | Matched |
| Sort options | Web sort controls | Sort modal and sort state | Matched |
| Pull/refresh behavior | Web fetch + loaders | Pull-to-refresh + background sync | Partial (platform-specific UX) |
| Home settings controls (columns, density, font) | Settings modal + localStorage | Grid settings modal + AsyncStorage | Matched |
| Theme flavor + market theme | Settings modal | Settings screen/context | Matched |
| Commodity detail chart | `commodity.js` (Chart.js) | `CommodityDetailScreen.tsx` + SVG chart | Partial (different chart engine/interaction model) |
| Price/percent chart mode | Supported | Supported | Matched |
| Range-based stats bar | Supported | Supported | Matched |
| Compare commodities on chart | Supported | Supported | Matched |
| Export chart image | Supported | Supported via view-shot/share | Matched |
| CSV export / copy | Supported | Copy CSV to clipboard | Partial (export mechanism differs) |
| Data source block + outbound source URL | Supported | Supported | Matched |
| Changelog screen | Web changelog page | Mobile changelog screen | Matched |
| Home filter/sort/view persistence | URL + storage-driven state | AsyncStorage restore/save for category/range/sort/view | Matched (platform-equivalent) |
| URL query-state persistence (`?range=&view=&category=`) | Strongly used | Not applicable in native app | Not 1:1 by design |
| Compact table critical row semantics | Rich compact table behavior | Compact row now includes frequency marker, trend context, and updated date semantics | Partial (improved) |
| Desktop hover sparkline/tooltips | Rich hover interactions in table | Touch-first compact row (no hover tooltips) | Not 1:1 by design |

## Confirmed Non-1:1 Deltas

1. **Routing model differs**
   - Web uses server route + URL params for view/range/category.
   - Mobile uses in-app navigation with persisted local state.

2. **Chart interaction model differs**
   - Web uses Chart.js with web-focused controls/tooltips.
   - Mobile uses custom SVG/native gestures and modals.

3. **Compact table interaction model differs**
   - Web compact table includes table-specific hover sparkline/tooltip interactions.
   - Mobile compact row now mirrors key data semantics, but remains touch-first (no hover UX).

4. **Export behavior differs**
   - Web may support direct file/download workflows.
   - Mobile uses share sheet + clipboard workflow.

## Overall Assessment

If your goal is **functional product parity**, mobile is very close.
If your goal is **strict interaction-by-interaction 1:1 parity**, it is not fully 1:1 yet.

Current sign-off state: **Functional parity achieved** with documented platform-specific deltas.

Execution plan: `WEB_PARITY_IMPLEMENTATION_PLAN.md`

## Recommended Next Steps for Near-1:1

1. Define a strict parity checklist at interaction level (per screen, per control).
2. Reconcile compact-table-only web interactions with mobile equivalents.
3. Align chart behavior details (tooltip behavior, crosshair details, export semantics).
4. Add parity regression tests that map web behavior specs to mobile expectations.
