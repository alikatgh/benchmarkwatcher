# Screen spec — Mobile Home (HomeScreen: grid + compact rows)

Surface: React Native (NativeWind). Verified via Expo web @375px (fallback: jest + typecheck + code review against rubric).

## Acceptance criteria (binary)

1. Brand parity: zero stock `slate-*`/`blue-*`/`emerald-*`/`rose-*` utilities in HomeScreen + row/card components — brand tokens (paper/ink/claret/teal/oxford/surface) only (UI-1).
2. Display text uses the serif display family; values semibold tabular; labels medium uppercase muted (UI-2).
3. CompactCommodityRow: no "Direction Up/Down" literal text — signed colored % is the only direction signal (UI-3).
4. Active/pressed states: bg-tint + color only; no off-brand blue highlights (UI-9); press feedback ≤ scale(0.96) `:active`-equivalent only.
5. Cards/rows: hairline borders, no shadow props (`shadow*`/elevation) on stationary surfaces.
6. Up/down colors come from `getMarketColors()` — no hardcoded green/red hexes.
7. Radius scale 3-step (8/12/full).
