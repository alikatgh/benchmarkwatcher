# /ralph-redesign

## Purpose
Bounded screenshot-driven redesign loop. Stop when spec criteria pass or after 5 iterations.

## Pre-conditions
- Screen spec exists with binary acceptance criteria
- `docs/UI_SYSTEM.md` populated
- `docs/SCREENSHOT_RUBRIC.md` exists

## Loop

1. Read `docs/RALPH_TASK_TEMPLATE.md`.
2. Take screenshot at 375px (mobile-first) AND 1280px.
3. Apply `docs/SCREENSHOT_RUBRIC.md`:
   - Any P0 fail → STOP, report to user
   - Any P1 fail → fix before continuing
4. Apply spec acceptance criteria.
5. Fix all failures. Do not change passing items.
6. Repeat. Max 5 iterations.
7. If all P0+P1 pass AND all criteria pass → DONE.
8. If 5 iterations exhausted → STOP, report remaining failures.

## Rule
One screen per loop. Mobile screenshot is the primary — desktop is secondary.
