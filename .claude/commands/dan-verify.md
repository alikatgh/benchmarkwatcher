# /dan-verify [file-or-component]

## Purpose
Full automated QA pipeline after `/dan-refactor`. RUNS tools, EXECUTES tests, CHECKS consumers, BUILDS the app. Dan refactors boldly; this skill proves he didn't break anything.

**If issues are found, they get logged to `docs/KNOWN_UI_DEBT.md` as DANV-* issues.**

## Arguments
- Required: the same file or component that was just refactored.

## When to use
Run this IMMEDIATELY after `/dan-refactor`. Every time. No exceptions.

## Pipeline (ALL steps, in order, no skipping)

### Step 1: Test Suite
```bash
cd ./client && npx vitest run --reporter=verbose 2>&1
```
- All pass → proceed.
- Fail in refactored file → Dan's change broke behavior. Log as DANV-* P0.
- Fail in other files → Dan broke a consumer. Log as DANV-* P0.
- No tests for this file → flag as risk, list what should be tested.

### Step 2: ESLint (full client)
```bash
cd ./client && npx eslint src/ 2>&1 | head -50
```
- Zero errors → proceed.
- `react-hooks/exhaustive-deps` → likely real issue from Dan's effect changes. Log as DANV-* P1.
- `no-unused-vars` → Dan removed usage but left import. Fix it directly.
- Errors in other files → Dan changed an export that broke consumers. Log as DANV-* P0.

### Step 3: Build
```bash
cd ./client && npx vite build 2>&1 | tail -30
```
- Builds → proceed.
- Import error → Dan renamed/removed an export. Log as DANV-* P0.

### Step 4: Consumer Verification
```bash
grep -r "import.*from.*[refactored-file]" src/ --include="*.jsx" --include="*.js" -l
grep -r "<ComponentName" src/ --include="*.jsx" --include="*.js" -l
```
For each consumer: READ it and verify props, context shape, hook return value, callback signatures match.

### Step 5: Diff Review
```bash
cd ../circles && git diff -- client/src/[refactored-file-path]
```
For each change: removed code truly dead? Effect deps complete? Derived state correct in all cases? Moved logic still triggers in all scenarios?

### Step 6: Socket.IO (if applicable)
```bash
grep -n "socket\.on\|socket\.off\|socket\.emit" src/[refactored-file-path]
```
Every `socket.on()` has matching `socket.off()` in cleanup. Reconnection re-subscribes.

### Step 7: Mobile (if applicable)
```bash
grep -n "safe-top\|safe-bottom\|env(safe-area" src/[refactored-file-path]
grep -n "isNativePlatform\|Capacitor" src/[refactored-file-path]
```
Safe area classes preserved. Touch targets ≥ 44px. Platform guards intact.

## Post-Verify: Log Issues to KNOWN_UI_DEBT.md (if issues found)

If ANY step found issues, WRITE them to `docs/KNOWN_UI_DEBT.md`.

### Issue ID format: `DANV-001`, `DANV-002`, etc.

### Each issue entry:
```markdown
### DANV-XXX: [issue title]
- **Priority:** P0 / P1
- **File:** [relative path]:[line number]
- **Category:** test-failure / lint-error / build-error / consumer-break / behavior-regression
- **What:** [1-2 sentence description]
- **Caused by:** [which dan-refactor change caused this]
- **Fix:** [concrete fix]
- **Status:** open
- **Found:** [YYYY-MM-DD]
```

## Output Format

```
## QA Report: [Component/File]

### Pipeline Results
| Step | Tool | Result | Details |
|------|------|--------|---------|
| 1. Tests | vitest | ✅ 47 pass, 0 fail | All green |
| 2. ESLint | eslint | ✅ 0 errors | — |
| 3. Build | vite build | ✅ Compiles | — |
| 4. Consumers | grep + read | ✅ 4 files | All compatible |
| 5. Diff | git diff | ✅ | No regressions |
| 6. Socket.IO | grep | N/A | No socket usage |
| 7. Mobile | grep | N/A | No Capacitor usage |

### Verdict: ✅ SAFE TO SHIP / ⚠️ SHIP AFTER FIXES / 🔴 DO NOT SHIP

### If ⚠️ or 🔴:
- Issues logged to KNOWN_UI_DEBT.md as DANV-XXX through DANV-YYY
- Run `/fix-gap DANV-XXX` for each, then re-run `/dan-verify`
- For 🔴: recommend `git checkout -- [file]` to revert, then re-approach
```

## Rules
- **RUN THE TOOLS.** Tests, lint, and build must be EXECUTED, not guessed at.
- You are NOT Dan. You care about correctness, not elegance.
- If tests don't exist, that's a risk — flag it, don't block on it.
- If Dan introduced a regression, say so clearly.
- For 🔴 verdict, RECOMMEND `git checkout` to the user — don't run it yourself.
- A ✅ verdict means: tests pass, lint clean, build compiles, consumers intact, diff reviewed. All five.
- **Log issues found to KNOWN_UI_DEBT.md so they feed into /fix-gap and /batch-fix.**
