# /design-screen [screen-name]

## Purpose
Produce a complete screen specification before any implementation begins.

## Arguments
- `screen-name`: e.g. `circle-detail`, `memory-feed`, `family-tree`, `invite-flow`, `subscription`

## Steps

1. Read `docs/UI_SYSTEM.md` — Tailwind tokens and conventions.
2. Read `docs/STACK_CONSTRAINTS.md` — React/Capacitor rules.
3. Read the current implementation of this screen (pages/ + components/).
4. Write `docs/screens/[screen-name].md`:

```markdown
# Screen: [screen-name]

## Purpose
[What this screen does and who uses it]

## Route
[React Router path]

## Layout Structure
[Sections, hierarchy, scroll behavior — note mobile vs desktop differences]

## Mobile Behavior
[Touch targets, gesture support, Capacitor-specific behavior]

### Safe Areas (required for every spec)
- **Header/top bar:** how it accounts for `env(safe-area-inset-top)` — e.g. `pt-safe-top`
- **Bottom actions/nav/FAB:** how it accounts for `env(safe-area-inset-bottom)` — e.g. `pb-safe-bottom`
- **Full-screen overlays:** must specify both top and bottom safe area handling
- **Fixed/sticky elements:** must specify which safe area utility they use
- [Any screen-specific safe area notes]

## States
- **Empty:** [no content — what shows]
- **Loading:** [skeleton or spinner — which pattern]
- **Populated:** [with data]
- **Error:** [on failure]

## Real-time Behavior
[Socket.IO events this screen listens to / emits, if any]

## Acceptance Criteria
- [ ] [Binary pass/fail — mobile 375px]
- [ ] [Binary pass/fail — touch targets >= 44px]
- [ ] [Binary pass/fail — i18n: no hardcoded strings]
- [ ] [Binary pass/fail — safe areas: all fixed/sticky elements use safe-area utilities, no hardcoded pt-16/pb-20]
- [ ] [Feature-specific criteria]

## Tailwind Token References
[Classes and custom tokens from UI_SYSTEM.md]
```

5. Update `SESSION_STATE.md`: active screen = [name], phase = design.
