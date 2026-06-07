# /implement-screen [screen-name]

## Purpose
Implement one approved screen spec. No spec = no implementation.

## Pre-conditions
- [ ] `docs/screens/[screen-name].md` exists with acceptance criteria
- [ ] `docs/UI_SYSTEM.md` has Tailwind tokens defined
- [ ] `docs/STACK_CONSTRAINTS.md` has been read

## Steps

1. Read all three pre-condition files.
2. Read current implementation files.
3. Implement changes:
   - Page component in `client/src/pages/`
   - Sub-components in `client/src/components/`
   - Hook logic in `client/src/hooks/` if needed
   - All strings through i18next
   - Safe area insets via CSS vars for Capacitor
4. Write `artifacts/logs/implement-[screen]-[YYYY-MM-DD].md`.
5. Update `SESSION_STATE.md`: phase = implemented.

## Rules
- No hardcoded English strings.
- Do not modify server/ without reading the route file first.
- Do not add npm packages without explicit approval.

### Safe Area Rules (Capacitor — mandatory)
- **Every fixed/sticky/absolute positioned element** MUST use safe area utilities — never hardcode `pt-16`, `pb-20`, etc.
- **Top**: use `pt-safe-top` (Tailwind) or `padding-top: env(safe-area-inset-top, 0px)` (CSS)
- **Bottom**: use `pb-safe-bottom` or `padding-bottom: env(safe-area-inset-bottom, 0px)`
- **Dynamic bottom**: use `safeBottom` from `useLayout()` (LayoutContext) for JS calculations
- **Headers**: `h-[calc(56px+var(--safe-top))] pt-safe-top`
- **Bottom nav/tabs/FABs**: `bottom: calc(Npx + var(--safe-bottom, 0px))`
- **Bottom sheets/modals with actions**: `pb-safe-bottom` on the last action row
- **Chat input bars**: `padding-bottom: calc(12px + var(--safe-bottom, 0px))`
- **Full-screen overlays** (lightbox, editors, video): both `pt-safe-top` and `pb-safe-bottom`
- Never use `--safe-bottom-fallback` for new code — use `--safe-bottom` or `safeBottom` from LayoutContext
- Available utilities: `pt-safe-top`, `pb-safe-bottom`, `pl-safe-left`, `pr-safe-right` (Tailwind), `--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right` (CSS vars)
