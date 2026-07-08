# Ralph Task Template

Per-loop worksheet for `/ralph-redesign`. One screen per loop, max 5 iterations.
Mobile (375px) screenshot is primary; desktop (1280px) secondary.

## Loop header

- **Screen:** <name + route>
- **Spec:** `docs/screens/<name>.md` (binary acceptance criteria)
- **Backlog items in scope:** <UI-n ids from KNOWN_UI_DEBT.md>

## Iteration record (repeat ≤5×)

### Iteration N
1. **Shoot:** 375px + 1280px, light + dark → `artifacts/shots/ralph/<screen>-i<N>-*.png`
2. **Rubric result:** list each P0/P1 failure with the rubric line it violates. P0 → STOP, report.
3. **Spec result:** list each acceptance criterion as PASS/FAIL.
4. **Fixes:** cascade-layer first (tokens in `base.html` / `tailwind.web.config.js` / `mobile/tailwind.config.js`), per-file only for residue. Do not touch passing items.
5. **Rebuild:** `npm run build:css` (web) before re-shooting.

## Exit

- All P0+P1 rubric checks pass AND all spec criteria pass → DONE. Update `KNOWN_UI_DEBT.md` statuses.
- 5 iterations exhausted → STOP, report remaining failures verbatim.
