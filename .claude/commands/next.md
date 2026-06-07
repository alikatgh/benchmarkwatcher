# /next

## Purpose
Recommend the single best next action based on current project state.

## Steps

1. Read `SESSION_STATE.md` if it exists.
2. Read `docs/KNOWN_UI_DEBT.md` if it exists — count open P0/P1/P2 issues.
3. Run `git status` — any uncommitted changes?

## Priority Table

| State | Recommendation |
|-------|----------------|
| No audit yet | Run `/audit-ui` or `/security-scan` |
| P0 issues open | Run `/fix-gap [P0-id]` or `/batch-fix` |
| P1 issues open | Run `/fix-gap [P1-id]` |
| Only P2/P3 remain | Run `/fix-gap [next-P2]` or polish |
| No KNOWN_UI_DEBT yet | Run `/dan-review` on the main entry point |
| Tests failing | Fix tests before continuing |
| Lint errors | Run `/lint-fix` |
| Code changed, tests pass | Run `/session-end` to save state |
| Clean branch, tests pass | "Ready to merge/deploy." |

4. Output: one recommended action with one sentence of reasoning.
