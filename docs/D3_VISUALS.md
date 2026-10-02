# D3 visualizations

All web data charts use self-hosted D3 7.9.0 (`app/static/js/vendor/`).
The shared renderer is `app/static/js/core/visuals.js`; explorer views are in
`app/static/js/components/visual_explorer.js`. No Chart.js script is loaded.
Unused Chart.js, date-adapter and zoom-plugin bundles have been removed. Icons and ordinary
interface controls remain HTML/SVG; a temporary canvas rasterizes SVG for PNG
and PowerPoint export only.

## Coverage

| Surface | D3 views and interactions |
| --- | --- |
| Benchmark table and appearance preview | Line, area, step, bars, average reference, optional seven-observation average and high/low markers |
| Category breadth | D3 stacked bars from published up/flat/down shares; missing shares remain unfilled |
| Company financial reports and sidebar answers | Line, area, step, bars, dots; annual/quarterly/trailing-year periods; keyboard inspection; exact filing evidence |
| Full benchmark page | Line, area, step, bars, dots; source-date axes; keyboard inspection; zoom/pan/reset; PNG and PowerPoint export |
| Detail and comparison pane | Line, area, step, dots, bars; date ranges; absolute values for compatible units; indexed comparison; observation tables |
| Visual explorer, individual benchmark | Line, area, step, bars, dots, observation-to-observation change, histogram, cumulative distribution, range/quartiles, monthly averages, year/month heatmap, observation coverage |
| Visual explorer, all benchmarks | Ranked changes, change map, category treemap, latest observation date counts |
| Workbook results and chat responses | Line, area, bars, dots; separate period frequencies and units; missing-value gaps; source-cell tables |
| Native app source | D3 scales, ticks, line/area generation and sparklines with react-native-svg rendering |

The dashboard explorer has its own benchmark and range controls. On a full
benchmark page it follows that page's selected observation window. All explorer
views include exact-value tables and PNG export.

## Data semantics

- Dates are UTC observation dates. Missing numeric values are not zeros.
- Lines break at explicit missing values and extended publication gaps.
- Full-page comparison never carries prices forward to another source's dates.
  Incompatible currency/unit pairs use percentage changes from each source's
  positive first available value; baseline dates can differ.
- Histograms count observations. Quartiles describe the selected sample; whiskers
  are the sample minimum and maximum. Monthly averages weight each available
  observation equally. These views do not predict future values.
- Category treemap area means benchmark count, not economic or price weight.
- Observation coverage is an observed count, not an estimate of source uptime.
- Workbook period ordering and units follow saved source values. A future-looking
  workbook label alone cannot establish whether a value is a historical result
  or an assumption. No new assumptions are generated.

## Verification

- `npm test -- --runInBand`: rendering/data invariants and existing UI tests.
- `npm run check:vocab`: product vocabulary.
- `npm run test:visuals`: isolated desktop/mobile D3 journeys, PNG downloads,
  all explorer modes, accessible controls and containment. Uses synthetic data.
- `npm run test:chat`: authenticated workbook journeys with simulated providers.
- `npm run test:companies`: company reports, native sidebar conversation, responsive layout and filing sources.
- `npm run test:e2e`: public UI regression suite.
- `.venv/bin/python -m pytest tests -q`: backend suite.
- `cd mobile && npm run typecheck`: native source typing.
- `cd mobile && npm test -- --runInBand __tests__/SVGLineChart.test.tsx __tests__/CompactCommodityRow.test.tsx __tests__/CommodityCard.test.tsx`: native chart consumers.

For a locally installed Chrome without downloaded Playwright Chromium, set
`PLAYWRIGHT_CHANNEL=chrome`. Native source checks do not imply a new store build
or device validation.

D3 API references: [scales](https://d3js.org/d3-scale),
[shapes](https://d3js.org/d3-shape), [zoom](https://d3js.org/d3-zoom).
