# /dan-refactor [file-or-component]

## Purpose
Refactor React code the way Dan Abramov would. Not cosmetic cleanup — structural improvement to data flow, state design, and effect correctness.

## Arguments
- Required: file path or component name to refactor.

## Pre-flight
1. Read the target file completely.
2. Read any custom hooks or context providers it imports (one level deep).
3. Run `/dan-review` mentally — identify the issues before touching code.
4. **Snapshot the current state:** Run tests and lint BEFORE changing anything so you have a baseline.
   ```bash
   cd ./client && npx vitest run --reporter=verbose --testPathPattern="[related-test-file]" 2>&1 | tail -20
   cd ./client && npx eslint [target-file] 2>&1 | tail -20
   ```

## Refactoring Priorities (in order)

### Priority 1: Fix broken mental models
These are bugs or will-be-bugs:
- **Effect cascades:** State A → effect sets state B → effect sets state C. Flatten to one effect or derive B and C.
- **Stale closures:** Event handlers or effects that capture stale state. Fix with proper deps or refs.
- **Sync state that should be derived:** Remove the `useState`, remove the syncing `useEffect`, compute the value inline or with `useMemo`.
- **Effects that should be event handlers:** If it only needs to run "when the user does X", move it to the event handler.

### Priority 2: Simplify state
- Merge states that always change together into a single `useState` object or `useReducer`.
- Remove state that duplicates props.
- Lift state up if two siblings need the same data (don't reach for context/store first).
- Push state down if only one child uses it.

### Priority 3: Straighten data flow
- Replace context-as-global-store patterns with proper prop drilling (if depth ≤ 3) or targeted context.
- Replace imperative ref-based parent-child communication with declarative props/callbacks.
- If a component receives 10+ props, compose it from smaller components using `children`.

### Priority 4: Clean up effects
- Split multi-purpose effects into single-purpose effects.
- Remove effects that only set state based on other state (derive instead).
- Add proper cleanup functions where missing (subscriptions, timers, abort controllers).
- Use `AbortController` for fetch in effects — don't ignore the race condition.

## How to refactor

1. **Show the plan first.** Before editing, list what you'll change and why.
2. **Make one type of change at a time.** Don't mix state simplification with effect cleanup in the same edit.
3. **Preserve behavior.** This is refactoring, not feature work. The component should do exactly the same thing after, just better structured.
4. **Run the quality gate after EACH change** (see below). Don't batch changes then test at the end.

## Post-Refactor Quality Gate (MANDATORY)

After EVERY set of edits — not at the end, after EACH logical change — run all of these:

### Gate 1: Tests
```bash
cd ./client && npx vitest run --reporter=verbose 2>&1 | tail -30
```
- If tests fail: **STOP. Fix the regression before making more changes.**
- If no tests exist for this file: note it in the output as a risk.
- Compare pass count against the pre-flight baseline — same or better.

### Gate 2: ESLint
```bash
cd ./client && npx eslint [refactored-file] 2>&1
```
- Zero new errors. Warnings are acceptable if they existed before.
- Pay special attention to `react-hooks/exhaustive-deps` — Dan's effect changes often trigger this.

### Gate 3: Consumer check
```bash
grep -r "ComponentName\|useHookName" src/ --include="*.jsx" --include="*.js" -l
```
- If you changed props, exports, or context shape: verify every consumer file still works.
- Read each consumer to confirm it passes the right props / accesses the right fields.

### Gate 4: Build check (final change only)
```bash
cd ./client && npx vite build 2>&1 | tail -20
```
- Must compile. No import errors, no missing exports, no type errors.

**If ANY gate fails, fix it before moving on. Do not skip gates.**

## Output Format

```
## Dan's Refactor: [Component/File]

### Diagnosis
[2-3 sentences: what's structurally wrong and why it matters]

### Changes
1. [Change description] — [why]
2. [Change description] — [why]

### Before → After
[Show the key structural changes, not every line]

### Quality Gate Results
| Gate | Before | After | Status |
|------|--------|-------|--------|
| Tests | 12 pass, 0 fail | 12 pass, 0 fail | ✅ |
| ESLint errors | 0 | 0 | ✅ |
| ESLint warnings | 2 | 1 | ✅ (reduced) |
| Consumers | 4 files | 4 files checked | ✅ all compatible |
| Build | — | compiles | ✅ |

→ Run `/dan-verify [file]` for full behavioral verification.
```

## Rules
- Do NOT rename variables for style. That's lint's job.
- Do NOT add TypeScript types. That's a separate task.
- Do NOT extract custom hooks unless the logic is reused in 2+ places.
- Do NOT add error boundaries, loading states, or features that weren't there.
- Every change must have a "why" grounded in React's mental model, not personal preference.
- If the code is already well-structured, say so and don't make changes for the sake of changes.
- **Quality gates are not optional.** If you skip them, the refactor is not done.
- **After refactoring, always remind the user to run `/dan-verify [file]`** for full behavioral and dependency verification.
