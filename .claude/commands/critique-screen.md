# /critique-screen [screen-name]

## Purpose
Review one implemented screen against its spec and screenshots.

## Steps

1. Read `docs/screens/[screen-name].md` — spec and acceptance criteria.
2. Read `docs/SCREENSHOT_RUBRIC.md` — stop conditions.
3. Take screenshots (Playwright MCP):
   - Start Vite: `cd ./client && npm run dev`
   - Desktop (1280px): `[screen]-populated-desktop-[date].png`
   - Mobile (375px): `[screen]-populated-mobile-[date].png`
4. Compare against spec and rubric.
5. **Safe area audit** (mandatory for every critique):
   - Grep the screen's component files for fixed/sticky/absolute positioned elements
   - Check each one uses `pt-safe-top`, `pb-safe-bottom`, or `env(safe-area-inset-*)` — not hardcoded `pt-16`/`pb-20`
   - Check bottom actions, FABs, input bars account for `--safe-bottom`
   - If violations found, log as CAP-* issues with the fix pattern from `/implement-screen` safe area rules
6. Write `artifacts/reviews/[screen-name]-[YYYY-MM-DD].md`.
7. Update `SESSION_STATE.md`: phase = critiqued.
8. If NEEDS_WORK: add issues to `docs/KNOWN_UI_DEBT.md`.
