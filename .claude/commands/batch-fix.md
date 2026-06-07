# /batch-fix

## Purpose
Fix all open P0 and P1 issues from `docs/KNOWN_UI_DEBT.md` in a single automated pass.

## Steps

1. Read `docs/KNOWN_UI_DEBT.md`. Collect all issues with `Status: open` AND priority P0 or P1.
2. Sort: SEC-* P0 first → all other P0 → P1.
3. For each issue: apply the `/fix-gap` workflow (read file, fix, quality gate).
4. **Between each fix:** run a quick smoke test to catch regressions early.
5. **After ALL fixes — final quality gate:**
   - Detect and run test suite (vitest / jest / pytest / go test / make test)
   - Detect and run linter (biome / eslint / ruff / gofmt)
6. If a fix causes a regression: revert that specific fix, mark it as blocked.
7. Update `docs/KNOWN_UI_DEBT.md` — mark fixed issues `Status: fixed [YYYY-MM-DD]`.
8. Report: issues fixed, issues skipped (with reason), final test/lint status.

## Rules
- Do not fix P2 or P3 in batch mode.
- SEC-* P0 issues are **never** skipped.
- Quality gate is mandatory. A fix that breaks tests is not a fix.
