# /fix-gap [issue-id]

## Purpose
Fix one tracked issue from `docs/KNOWN_UI_DEBT.md`. Targeted, minimal change.

## Supported Prefixes
`P0`, `P1`, `P2`, `P3`, `DAN`, `SEC`, `PERF`, `A11Y`, `API`, `DB`,
`ENV`, `CONTRACT`, `RT`, `BUG`, `MAP`, `SSE`, `CAP`, `PAY`, `STORE`

## Steps

1. Find the issue by ID in `docs/KNOWN_UI_DEBT.md`.
2. Read the referenced file(s).
3. If the issue includes a **Fix** section with concrete code, apply it exactly.
4. Change only what is necessary. Touch nothing else.
5. **Run quality gate (mandatory):**
   - Detect test runner (vitest / jest / pytest / go test) → run tests
   - Detect linter (biome / eslint / ruff / gofmt) → lint changed file
   - Gate failure → fix regression or revert and note blocker
6. Mark issue: `Status: open` → `Status: fixed [YYYY-MM-DD]` in KNOWN_UI_DEBT.md.
7. Write `artifacts/logs/fix-[id]-[YYYY-MM-DD].md` with: root cause, change, gate result.
8. Update `SESSION_STATE.md`.

## Rules
- Only fix issues tracked in KNOWN_UI_DEBT.md — add untracked issues first.
- Quality gate is mandatory. Do not mark fixed if gate fails.
- SEC-* P0 issues: fix immediately, never defer.
