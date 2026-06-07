# /perf-audit [scope]

## Purpose
Performance audit for React client. Analyze bundle size, render efficiency, data fetching, and loading strategy.

**Every issue found gets logged to `docs/KNOWN_UI_DEBT.md` as PERF-* issues so they can be fixed by `/fix-gap`, `/batch-fix`, or `/dan-refactor`.**

## Arguments
- Optional: `bundle`, `renders`, `loading`, `all`. Defaults to `all`.

## Steps

### 1. Bundle Analysis
Read vite.config.js and package.json. Run:
```bash
cd ./client && npx vite build --mode production 2>&1 | tail -50
```
Check for: heavy eager imports, missing code splitting, tree-shaking blockers, duplicate deps, CSS bloat.

### 2. Re-render Audit
Read context providers and components consuming multiple contexts.

Check for: context value instability (new object every render), over-broad context, missing memoization on expensive computations, missing `React.memo` on leaf components, inline functions in hot paths, key-based remounting.

### 3. Data Fetching & Loading
Read api.js and hooks that fetch data.

Check for: waterfall fetches (should be `Promise.all`), missing abort controllers, cache strategy gaps, over-fetching, no loading/error states, redundant fetches.

### 4. Image & Media
Check for: missing `loading="lazy"`, missing dimensions (layout shift), Cloudinary at display size, heic2any lazy-loaded.

### 5. List Performance
Check for: long lists without React Virtuoso, missing pagination, expensive per-item computation.

## Output Format

Print the audit, THEN log issues.

```
## Performance Audit

### Bundle
| Chunk | Size | Issue | Recommendation |

### Re-render Hotspots
| Component | Trigger | Impact | Fix |

### Data Fetching
| Location | Pattern | Issue | Fix |

### Quick Wins (do these first)
1. ...
```

## Post-Audit: Log Issues to KNOWN_UI_DEBT.md (MANDATORY)

After printing, WRITE every issue to `docs/KNOWN_UI_DEBT.md`.

### Severity mapping
- Re-render causes visible jank on mobile → **P0**
- Bundle chunk > 500KB that should be split → **P1**
- Missing lazy loading, waterfall fetches → **P1**
- Missing memoization (no visible impact yet) → **P2**

### Issue ID format: `PERF-001`, `PERF-002`, etc.

### Each issue entry:
```markdown
### PERF-XXX: [issue title]
- **Priority:** P0 / P1 / P2
- **File:** [relative path]:[line number]
- **Category:** bundle / render / fetch / media / list
- **What:** [1-2 sentence description]
- **Fix:** [concrete fix — specific memoization, code split, Promise.all, etc.]
- **Status:** open
- **Found:** [YYYY-MM-DD]
```

### After writing:
1. Print: `Logged X issues to KNOWN_UI_DEBT.md (PERF-XXX through PERF-YYY)`
2. Tell user: `Run /fix-gap PERF-XXX or /dan-refactor [file] for render issues.`

## Rules
- Read actual code. Performance issues must include file:line.
- Don't suggest Next.js, Remix, or SSR — this is a Vite SPA + Capacitor app.
- Memoization only where re-renders are measured or likely expensive.
- Mobile (375px) performance matters most.
- Web3 chunk is already feature-flagged — don't re-flag it.
- **Never skip the logging step.**
