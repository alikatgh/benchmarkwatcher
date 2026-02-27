# Mobile App Improvement Plan

Bring the web commodity detail page features to the React Native (Expo) mobile app.

---

## Features to Port

| # | Feature | Web Implementation | Mobile Status |
|---|---------|-------------------|---------------|
| 1 | Multi-commodity comparison | Chart.js multi-dataset, secondary Y-axis, compare menu | Not started — SVGLineChart is single-series only |
| 2 | Chart settings panel | Full-screen mobile / side panel desktop, theme presets, line/fill/grid controls | Not started — only basic toggles exist in CommodityChartControls |
| 3 | Scrollable crosshair info | `overflow-x-auto` flex container with Date/Price/Change | Not started — touch-based selection exists but no scrollable info bar |
| 4 | Settings button in chart actions | Button moved from header to actions bar | Partially exists — settings are inline toggles, no dedicated button/panel |

---

## 1. Multi-Commodity Comparison

### What it does (web)
Users can overlay multiple commodities on the same chart to compare price dynamics. Supports both absolute price mode (secondary Y-axis) and percent change mode (shared axis, normalized to start date).

### Implementation plan

#### 1.1 Update types — `mobile/types/commodity.ts`
- Add missing fields: `history`, `source_name`, `source_url`, `source_type`, `updated_at`, `derived`
- Add `ComparisonSeries` type:
  ```ts
  interface ComparisonSeries {
    id: string;
    name: string;
    color: string;
    history: { date: string; price: number }[];
  }
  ```

#### 1.2 Update API layer — `mobile/api/commodities.ts`
- `fetchCommodityDetail(id)` already exists but verify it returns full `history` array
- Add `fetchAllCommodityNames()` or reuse `fetchCommodities()` to get the list of available commodities for the comparison picker (only `id`, `name`, `category` needed)

#### 1.3 Extend SVGLineChart — `mobile/components/features/SVGLineChart.tsx`
Currently renders a single series with Catmull-Rom interpolation. Changes needed:

- **New prop**: `comparisons: ComparisonSeries[]` (array of overlay datasets)
- **Date alignment**: Build a date→index map from the primary series. For each comparison series, align data points to matching dates (skip dates not in primary)
- **Percent mode**: When `viewMode === 'percent'`, normalize all series to their first visible value (value / firstValue - 1) × 100
- **Price mode**: Primary series uses left Y-axis. Comparison series share a computed right Y-axis scaled to the min/max of comparison data
- **Rendering**: For each comparison series, render an additional `<Path>` with its assigned color, using the same Catmull-Rom interpolation
- **Touch selection**: When user touches the chart, show values for ALL visible series (primary + comparisons) at that x-position
- **Legend**: Add a small legend row below the chart showing colored dots + commodity names when comparisons are active

#### 1.4 Comparison picker modal — NEW `mobile/components/features/CompareModal.tsx`
- Modal triggered by a "Compare" button in the chart actions area
- Search input at top (filters commodity list by name)
- Scrollable list of commodities grouped by category
- Each item has a checkbox/toggle to add/remove from comparison
- Shows assigned color swatch next to selected items
- Max 4 comparisons (8 colors available, but mobile screen is smaller)
- "Clear All" button at bottom

#### 1.5 Comparison state management — `mobile/screen/CommodityDetailScreen.tsx`
- Add state:
  ```ts
  const [comparisons, setComparisons] = useState<ComparisonSeries[]>([]);
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  ```
- Color palette: `['#e11d48', '#8b5cf6', '#f59e0b', '#06b6d4', '#84cc16', '#ec4899', '#14b8a6', '#f97316']`
- When user selects a commodity in CompareModal:
  1. Fetch its detail data via `fetchCommodityDetail(id)`
  2. Extract `history` array
  3. Assign next color from palette
  4. Add to `comparisons` state
- When user removes a commodity: filter it out of `comparisons`
- Pass `comparisons` down to `CommodityChartSection` → `SVGLineChart`

#### 1.6 Comparison bar — `mobile/components/features/CommodityChartControls.tsx`
- When comparisons are active, show a horizontal scrollable row of colored tags (commodity name + × remove button) above the chart controls
- Tapping a tag removes that comparison

### Key decisions
- **Max comparisons**: 4 on mobile (vs 8 on web) to keep chart readable on small screens
- **Color assignment**: Sequential from palette, not recycled until all used
- **Data fetching**: Fetch each comparison commodity's full detail on-demand (not prefetched)
- **Efficiency**: Limit comparison history to same date range as primary commodity's visible range

---

## 2. Chart Settings Panel

### What it does (web)
Full-screen panel on mobile, side panel on desktop. Controls: theme presets (8 themes), line color, fill color, fill opacity, grid toggle, grid color, animation toggle, tension slider.

### Implementation plan

#### 2.1 New settings modal — NEW `mobile/components/features/ChartSettingsModal.tsx`
- Full-screen modal (React Native `Modal` with `presentationStyle="fullScreen"`)
- Sections:

**Theme Presets**
- Grid of theme swatches (2 columns on small screens, 3 on tablets)
- Each swatch shows a preview rectangle with the theme's line/fill/background colors
- Themes: Default, Ocean, Sunset, Forest, Midnight, Neon, Pastel, Monochrome
- Tapping a theme applies its `lineColor`, `fillColor`, `fillOpacity`, `gridColor`, `backgroundColor`

**Line Settings**
- Line color picker (color swatches grid)
- Line tension slider (0 = angular, 0.4 = smooth) using a `Slider` component

**Fill Settings**
- Fill enabled toggle (`Switch`)
- Fill color picker (color swatches grid, shown only when fill enabled)
- Fill opacity slider (0–1)

**Grid Settings**
- Grid visible toggle (`Switch`)
- Grid color picker (shown only when grid visible)

**Animation**
- Animation enabled toggle (`Switch`)

**Actions**
- "Reset to Default" button at bottom
- "Done" button in header/top-right

#### 2.2 Persist chart settings — `mobile/context/SettingsContext.tsx`
- Add to existing `Settings` interface:
  ```ts
  chartTheme: string;          // theme preset name
  chartLineColor: string;
  chartFillColor: string;
  chartFillOpacity: number;
  chartGridVisible: boolean;
  chartGridColor: string;
  chartAnimationEnabled: boolean;
  chartLineTension: number;
  ```
- Add defaults in `DEFAULT_SETTINGS`
- These persist via AsyncStorage alongside existing settings

#### 2.3 Apply settings in SVGLineChart — `mobile/components/features/SVGLineChart.tsx`
- Accept new props from settings context: `lineColor`, `fillColor`, `fillOpacity`, `gridVisible`, `gridColor`, `lineTension`
- Replace hardcoded color values with these props
- Apply `lineTension` to Catmull-Rom `alpha` parameter (0 = linear, 0.4 = smooth catmull-rom)
- Conditionally render grid lines based on `gridVisible`

#### 2.4 Trigger button — `mobile/components/features/CommodityChartControls.tsx`
- Add a gear/settings icon button in the controls bar
- Opens `ChartSettingsModal`

### Key decisions
- **No color picker wheel**: Use predefined color swatches (12–16 colors) for simplicity. A full color picker is complex in RN and overkill for this use case
- **Theme presets first**: Most users will just pick a theme rather than customize individual colors
- **Settings scope**: Chart settings are global (apply to all commodity charts), not per-commodity

---

## 3. Scrollable Crosshair / Selection Info

### What it does (web)
When hovering over the chart, a crosshair tooltip shows Date, Price, and Change. On mobile web, this row is horizontally scrollable when it overflows.

### Current mobile behavior
`SVGLineChart.tsx` has touch-based selection that shows a vertical line and a tooltip bubble with price. There's no separate info bar.

### Implementation plan

#### 3.1 Selection info bar — `mobile/components/features/SVGLineChart.tsx` or new component
- When a data point is selected (via touch), render an info bar below the chart (not as an overlay tooltip)
- Bar content: **Date** | **Price** | **Change** (absolute + percent from previous point)
- When comparisons are active: show a row for each series (primary + comparisons), color-coded
- Wrap in `<ScrollView horizontal showsHorizontalScrollIndicator={false}>` so it scrolls when content overflows (especially with comparison data)

#### 3.2 Data calculation
- Already have `selectedIndex` in SVGLineChart state
- Calculate change: `history[selectedIndex].price - history[selectedIndex - 1].price`
- Percent change: `(change / previousPrice) * 100`
- For comparisons: same calculation per series at the aligned date

#### 3.3 Styling
- Use market color theme from SettingsContext (`positiveColor` / `negativeColor`) for change values
- Compact layout: Date left-aligned, Price center, Change right-aligned
- Font size slightly smaller than main display (`text-xs` / 11px)

### Key decisions
- **Bar vs tooltip**: Use a bar below the chart instead of a floating tooltip. More stable on touch, doesn't obscure chart data
- **Always visible**: Bar shows "Touch chart to select" hint when no point selected
- **Comparison rows**: Stack vertically if >2 series, scroll horizontally if values overflow

---

## 4. Settings Button Placement

### What it does (web)
The settings gear was moved from the chart header into the chart actions bar (alongside Reset View and Download).

### Current mobile layout
`CommodityChartControls.tsx` has a row of controls: range buttons, view mode picker, appearance toggles (dark mode, colors), zoom controls, and an export button. There is no separate "settings" button — customization options are inline toggles.

### Implementation plan

#### 4.1 Reorganize CommodityChartControls — `mobile/components/features/CommodityChartControls.tsx`
Current layout (top to bottom):
1. Range buttons (1M, 3M, 6M, 1Y, 5Y, ALL)
2. View mode (Price / Percent)
3. Appearance toggles (dark, market colors)
4. Zoom buttons + Export

New layout:
1. Range buttons (1M, 3M, 6M, 1Y, 5Y, ALL)
2. View mode (Price / Percent)
3. Action buttons row: **Compare** | **Settings** (gear icon) | **Export** (camera icon)

- Remove inline appearance toggles (dark mode, market colors) — these move into the Chart Settings Modal (Feature 2)
- "Compare" button opens CompareModal (Feature 1)
- "Settings" button opens ChartSettingsModal (Feature 2)
- "Export" button remains (existing ViewShot capture)

#### 4.2 Simplify the controls component
- Remove `darkMode` and `useMarketColors` toggle props (moved to settings modal)
- Remove zoom +/- buttons (rarely used on mobile, pinch-to-zoom is more natural if needed later)
- Result: cleaner, less cluttered control bar

### Key decisions
- **Remove inline toggles**: Moving them to the settings modal reduces visual clutter
- **3-button action row**: Compare, Settings, Export — clean and scannable
- **No zoom buttons**: Remove for now; can add pinch-to-zoom gesture to SVGLineChart later if needed

---

## Implementation Order

Recommended sequence (each phase builds on the previous):

### Phase 1: Foundation
1. **Update types** (`commodity.ts`) — add missing fields
2. **Update SettingsContext** — add chart settings with defaults
3. **Persist and load** chart settings via AsyncStorage

### Phase 2: Chart Settings
4. **Create ChartSettingsModal** — theme presets + individual controls
5. **Apply settings to SVGLineChart** — colors, fill, grid, tension
6. **Reorganize CommodityChartControls** — new action buttons row, remove inline toggles

### Phase 3: Comparison
7. **Extend SVGLineChart** — multi-series rendering, dual Y-axis, legend
8. **Create CompareModal** — searchable commodity picker
9. **Wire up comparison state** in CommodityDetailScreen
10. **Add comparison bar** (active comparison tags)

### Phase 4: Selection Info
11. **Add selection info bar** — date/price/change below chart
12. **Extend for comparisons** — multi-series selection display
13. **Horizontal scroll** for overflow

### Phase 5: Polish
14. **Animations** — modal transitions, chart series fade-in
15. **Optimisation** — memoize comparison path calculations, limit re-renders
16. **Testing** — verify on iOS simulator, Android emulator, physical device

---

## Files to Create

| File | Purpose |
|------|---------|
| `mobile/components/features/ChartSettingsModal.tsx` | Full-screen chart customization modal |
| `mobile/components/features/CompareModal.tsx` | Commodity comparison picker modal |

## Files to Modify

| File | Changes |
|------|---------|
| `mobile/types/commodity.ts` | Add `history`, `source_name`, `source_url`, `updated_at`, `ComparisonSeries` |
| `mobile/context/SettingsContext.tsx` | Add chart appearance settings + defaults |
| `mobile/components/features/SVGLineChart.tsx` | Multi-series rendering, configurable colors/fill/grid, selection info bar |
| `mobile/components/features/CommodityChartControls.tsx` | New action buttons row, remove inline toggles |
| `mobile/components/features/CommodityChartSection.tsx` | Pass chart settings and comparisons to SVGLineChart |
| `mobile/screen/CommodityDetailScreen.tsx` | Comparison state, modal triggers, fetch comparison data |
| `mobile/api/commodities.ts` | Verify detail endpoint returns history (may need no changes) |

---

## Design Guidelines

- **Colors**: Reuse the existing `marketColors` from SettingsContext for positive/negative indicators. Chart customization colors use the same palette as web.
- **Modals**: Use React Native `Modal` with slide-up animation. Full-screen with a header bar containing title + Done/Close button.
- **Touch targets**: Minimum 44×44pt for all tappable elements (Apple HIG).
- **Scrolling**: Use `ScrollView` inside modals for long content. Horizontal `ScrollView` for comparison tags and selection info overflow.
- **Dark mode**: All new components must respect the existing `darkMode` setting from SettingsContext.
- **Typography**: Match existing app fonts. Use `text-sm` (14px) for controls, `text-xs` (12px) for secondary info.
