# /api-contract [scope]

## Purpose
Validate frontend API calls match backend route contracts. Check that what the client sends matches what the server expects, and what the server returns matches what the client uses.

**Every mismatch gets logged to `docs/KNOWN_UI_DEBT.md` as CONTRACT-* issues so they can be fixed by `/fix-gap` or `/batch-fix`.**

## Arguments
- Optional: route name (e.g., `memories`, `auth`, `circles`), or `all`. Defaults to `all`.

## Steps

### 1. Map Backend Contracts
For each route file: extract method, path, middleware, controller. Read controller for: expected body fields, query params, URL params, response shape, error responses.

### 2. Map Frontend API Calls
Grep `api.get(`, `api.post(`, `api.put(`, `api.delete(` across client. Extract endpoint, body/params, and where response is consumed.

### 3. Contract Validation

#### Request Mismatches
Missing fields, extra fields, wrong field names, wrong types, wrong HTTP method, wrong path.

#### Response Mismatches
Accessing undefined fields, missing error handling, shape assumptions (array vs wrapper).

#### Auth Mismatches
Calling protected routes without token, POST/PUT/DELETE without CSRF.

### 4. Orphan Detection
Dead endpoints (server routes no client calls), dead client calls (to non-existent routes), unused response fields.

## Output Format

Print the report, THEN log issues.

```
## API Contract Report

### Mismatches
| # | Client Call | Server Route | Type | Issue |

### Orphaned Endpoints
| Method | Path | Controller | Note |

### Dead Client Calls
| Client Location | Endpoint | Note |

### Summary
- Matched: X, Mismatches: X, Orphaned: X, Dead: X
```

## Post-Audit: Log Issues to KNOWN_UI_DEBT.md (MANDATORY)

After printing, WRITE every mismatch to `docs/KNOWN_UI_DEBT.md`.

### Severity mapping
- Missing required field → client call always fails → **P0**
- Wrong response shape → runtime crash → **P0**
- Missing auth on mutation → security + failure → **P0**
- Extra/unused fields → dead code → **P2**
- Orphaned endpoints → cleanup → **P2**

### Issue ID format: `CONTRACT-001`, `CONTRACT-002`, etc.

### Each issue entry:
```markdown
### CONTRACT-XXX: [issue title]
- **Priority:** P0 / P1 / P2
- **Client file:** [path]:[line]
- **Server file:** [path]:[line]
- **Type:** request-mismatch / response-mismatch / auth-mismatch / orphan
- **What:** [1-2 sentence description]
- **Fix:** [which side to change and how]
- **Status:** open
- **Found:** [YYYY-MM-DD]
```

### After writing:
1. Print: `Logged X issues to KNOWN_UI_DEBT.md (CONTRACT-XXX through CONTRACT-YYY)`
2. Tell user: `Run /fix-gap CONTRACT-XXX for one at a time, or /batch-fix for all P0/P1.`

## Rules
- Read actual code on both sides.
- Vite proxies `/api` to localhost:5001 — client paths don't include base URL.
- Admin endpoints called from admin pages aren't orphaned.
- Webhook endpoints (Stripe, Apple, Google) are called externally — not orphaned.
- Socket.IO events are NOT REST — use `/socket-debug` for those.
- **Never skip the logging step.**
