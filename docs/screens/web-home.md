# Screen spec — Web Home (grid + compact + Market Pulse)

Route: `/` (grid view default; `/?view=compact` for the table). Themes: light + dark.

## Acceptance criteria (binary)

1. Grid price card: hover changes border-color/text-color only — no translate, no gradient fade-in, no shadow (UI-7).
2. Card anatomy = 3 type roles: serif display name, semibold tabular price, one muted uppercase label row. No other bold text on the card (UI-2).
3. Directional signals: badge = glance (▲ + %), body = detail (signed % + abs). This split was reviewed and kept intentionally (UI_POLISH_REPORT #5) — do not add a third signal (no direction words, no extra arrows).
4. Market Pulse: tiles are flat, hairline-bordered, spacing rhythm equal to the grid cards; no nested tile-within-tile borders (UI-8).
5. All radii ∈ {8px controls, 12px cards, full pills} (UI-6).
6. No `box-shadow` on any stationary surface (UI-5).
7. Label sizes: only the two token sizes below 14px; no `text-[9px]`/`text-[10px]`/`text-[11px]` arbitrary utilities remain in grid/compact/pulse templates (UI-4).
8. 375px: single-column cards, no horizontal overflow, filters wrap, ≥40px tap targets on view/range controls.
9. Dark theme: canvas < card ≥6% lightness step; teal/claret preserved.
10. Compact table: hairline rows, tabular-nums aligned columns, 2-decimal prices.
