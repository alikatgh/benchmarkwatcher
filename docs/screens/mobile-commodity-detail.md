# Screen spec — Mobile Commodity Detail (CommodityDetailScreen)

Surface: React Native (NativeWind). Verified via Expo web @375px (fallback: jest + typecheck + code review against rubric).

## Acceptance criteria (binary)

1. Brand parity: zero stock `slate-*`/`blue-*`/`emerald-*`/`rose-*` utilities in CommodityDetailScreen + chart/stats/controls components (UI-1).
2. Header: serif display name; price semibold tabular; % change the single colored accent.
3. Chart controls: active segment = brand bg-tint + color, no geometry change; ≥40×40 hit areas.
4. SVGLineChart + stats bar colors flow from `getMarketColors()` / theme tokens, not hardcoded.
5. Stats bar labels: medium uppercase muted, one size token; values tabular semibold (UI-2/UI-4).
6. No shadows/elevation on stationary cards.
