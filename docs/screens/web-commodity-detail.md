# Screen spec — Web Commodity Detail

Route: `/commodity/gold` (representative). Themes: light + dark.

## Acceptance criteria (binary)

1. Header: serif display commodity name; latest price semibold tabular; change % the single colored accent in the header region.
2. Stats bar / metadata: labels medium uppercase muted, values semibold tabular — no blanket bold (UI-2).
3. Range/frequency controls: active state = bg-tint + color, no geometry change; radius 8px; ≥40px hit area at 375px.
4. Chart card: flat, hairline border, 12px radius, no shadow.
5. No decorative icons next to self-explanatory labels.
6. 375px: chart fits width, controls wrap without overflow, breadcrumb truncates gracefully.
7. Dark theme: chart gridlines/labels legible; surface steps hold.
8. Only token label sizes below 14px (UI-4).
