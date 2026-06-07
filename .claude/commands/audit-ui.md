# /audit-ui

## Purpose
Audit the project UI: screens, component quality, mobile behavior, and tracked issues.

## Steps

1. Read `SESSION_STATE.md` for existing context (if it exists).
2. Identify the entry point: look for `src/App.tsx`, `src/App.jsx`, `src/main.tsx`, `pages/`, or `app/` directory.
3. Read the routing structure and list all screens/routes.
4. For each screen, check:
   - Does it handle loading / error / empty states?
   - Does it work at 375px mobile width?
   - Are touch targets ≥ 44px?
   - Is text readable at default font size?
   - Does navigation work correctly?
5. Log every issue to `docs/KNOWN_UI_DEBT.md` (create if missing).

## Produce or update
- `docs/SCREEN_INVENTORY.md` — every screen: route, component, status
- `docs/UI_SYSTEM.md` — design tokens, component patterns
- `docs/KNOWN_UI_DEBT.md` — all issues P0–P3
- `SESSION_STATE.md`

## Issue Priority
- **P0:** Broken — crashes, data not visible, action impossible
- **P1:** Serious — wrong data, mobile layout broken, real-time event lost
- **P2:** Quality — missing states (empty/loading/error), inconsistency
- **P3:** Polish — spacing, colour, animation

## Mode Recommendation
- >3 screens with layout/hierarchy issues → **Redesign mode**
- Specific isolated bugs → **Fix mode**
