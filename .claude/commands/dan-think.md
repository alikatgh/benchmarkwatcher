# /dan-think [question]

## Purpose
Think through a React architecture decision the way Dan Abramov would. No code — just reasoning about the right approach. Use this when you're stuck on "where should this state live?" or "should I use context or props?" or "how do I structure this data flow?"

**Every decision gets saved to `docs/decisions/` so it survives the session.**

## Arguments
- Required: the question or decision you're facing. Can be freeform.

## How Dan thinks about architecture

### Start from the data, not the UI
- What is the source of truth? Server? URL? User input?
- What transforms happen between source and display?
- Draw the data flow first, then map components to it.

### State placement checklist
Ask these questions in order:
1. **Can it be derived?** → Don't store it.
2. **Is it local to one component?** → `useState` in that component.
3. **Is it shared by siblings?** → Lift to nearest common parent.
4. **Is it needed by distant descendants?** → Still lift to common ancestor, pass via props (depth ≤ 3) or context (depth > 3).
5. **Is it server state?** → It belongs in a cache (React Query, SWR, or a fetch-in-effect with proper cleanup). Not in `useState`.
6. **Is it URL state?** → It belongs in the URL. Use router params/search params.
7. **Is it complex with many transitions?** → `useReducer`.

### Context vs. props vs. store
- **Props:** Default. Always start here. "Prop drilling" through 2-3 levels is fine and explicit.
- **Context:** For values that are "environmental" — theme, locale, auth, router. Not for frequently-changing data (causes broad re-renders).
- **External store (Zustand, Redux):** For state shared across unrelated component trees, or state that needs to survive component unmounts, or when you need fine-grained subscriptions. Use `useSyncExternalStore` for correctness.

### When to split a component
- It has **multiple independent reasons to re-render** — split so each part only re-renders for its own reason.
- It has **multiple independent pieces of state** that don't interact — split so each piece is local.
- It's **hard to name** — if you can't describe what it does in one phrase, it's doing too much.
- Do NOT split just because it's "long." 200 lines of cohesive logic is better than 5 files of scattered logic.

### Real-time / Socket.IO specific (for Circles)
- Socket event listeners are effects that synchronize external events with local state.
- Always clean up listeners in the effect cleanup.
- Reconnection: the effect should re-subscribe on reconnect. Use Socket.IO's `connect` event.
- Don't store socket instance in state — it's not state, it's a resource. Use a ref or module-level variable.
- Optimistic updates: update local state immediately in the event handler, then let the server event confirm/correct.

### Data fetching
- Fetch is a side effect → lives in an effect (or a data fetching library).
- Always handle the race condition: if the component re-renders with new props before the fetch completes, the old fetch's result should be discarded.
- Pattern: `useEffect` with `AbortController`, or use React Query / SWR which handle this automatically.
- Loading and error states are derived from the fetch lifecycle, not separate booleans you manage manually.

## Output Format

Print the decision to the user, THEN save it to disk.

```
## Dan's Take: [short restatement of the question]

### The key question is...
[Reframe the problem in terms of data flow and state ownership]

### My recommendation
[Clear recommendation with reasoning]

### Why not [alternative]?
[Address the obvious alternative]

### In practice
[Short code sketch if helpful — max 20 lines, structure only]
```

## Post-Think: Save Decision (MANDATORY)

After printing the decision, SAVE it to `docs/decisions/`.

### File format
Create `docs/decisions/[YYYY-MM-DD]-[slug].md`:

```markdown
# Decision: [short title]

**Date:** YYYY-MM-DD
**Question:** [original question]
**Status:** decided / superseded by [link]

## Context
[What prompted this question — the component, the feature, the problem]

## Decision
[The recommendation — what to do and why]

## Alternatives Considered
[What was rejected and why]

## Implementation Notes
[Code sketch, affected files, migration path if applicable]

## Consequences
- [What this enables]
- [What this constrains]
- [What to watch for]
```

### After saving:
1. Print: `Decision saved to docs/decisions/[filename].md`
2. If the decision implies code changes, tell user which skill to run next:
   - Architecture change → `/dan-refactor [file]`
   - New component structure → `/implement-screen [name]`
   - Performance issue → `/fix-gap PERF-XXX`

## Rules
- No code unless it clarifies the architecture. This is a thinking skill, not an implementation skill.
- Always ground recommendations in React's actual model.
- Don't say "it depends" without then actually deciding for the specific case.
- If the question is too vague, ask one clarifying question, then answer based on the most likely scenario.
- For Circles-specific questions, account for Socket.IO real-time requirements and Capacitor mobile constraints.
- **Never skip the save step. Architecture decisions not recorded are decisions that get relitigated.**
