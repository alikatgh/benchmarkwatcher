# /api-audit [scope]

## Purpose
Audit Express API routes for consistency, security gaps, and missing patterns. You are a senior API architect reviewing every route for proper auth, validation, rate limiting, error handling, and RESTful design.

**Every issue found gets logged to `docs/KNOWN_UI_DEBT.md` as API-* issues so they can be fixed by `/fix-gap` or `/batch-fix`.**

## Arguments
- Optional: route file name (e.g., `memoryRoutes`), `auth`, `validation`, `consistency`, or `all`. Defaults to `all`.

## Steps

### 1. Route Inventory
Read all route files in `./server/ or backend/routes/`. Build a table of every endpoint: method, path, middleware chain, controller function.

### 2. Auth Coverage
For every endpoint, verify: protected routes have `protect`, optional auth where appropriate, admin routes have `isAdmin`, no auth bypass, consistent pattern.

### 3. Validation Gaps
For every endpoint with input: body validation on POST/PUT, param validation (ObjectId), query param checks, file upload validation, missing sanitization.

### 4. Rate Limiting Coverage
For every state-changing endpoint: create endpoints limited, auth endpoints strict, upload per-user, delete limited.

### 5. Error Handling Consistency
For every controller: null checks on lookups, authorization checks, consistent error format, correct HTTP status codes.

### 6. REST Design
Consistent naming, proper HTTP methods, consistent response shape, pagination on list endpoints, idempotent PUT/DELETE.

## Output Format

Print the report, THEN log issues.

```
## API Audit Report

### Route Inventory
Total: X endpoints across Y route files

### Auth Gaps
| Route | Method | Path | Issue |

### Validation Gaps
| Route | Issue | Risk |

### Rate Limiting Gaps
| Route | Method | Path | Recommendation |

### Consistency Issues
| Category | Issue | Affected Routes |

### Summary
```

## Post-Audit: Log Issues to KNOWN_UI_DEBT.md (MANDATORY)

After printing the report, WRITE every issue to `docs/KNOWN_UI_DEBT.md`.

### Severity mapping
- Missing auth on mutation endpoint → **P0**
- Missing validation (crash on bad input) → **P0**
- Missing rate limiting on auth endpoints → **P1**
- Inconsistent response format → **P2**

### Issue ID format: `API-001`, `API-002`, etc.

### Each issue entry:
```markdown
### API-XXX: [issue title]
- **Priority:** P0 / P1 / P2
- **File:** [relative path]:[line number]
- **Category:** auth / validation / rate-limiting / consistency
- **What:** [1-2 sentence description]
- **Fix:** [concrete fix — which middleware to add, which validation to write]
- **Status:** open
- **Found:** [YYYY-MM-DD]
```

### After writing:
1. Print: `Logged X issues to KNOWN_UI_DEBT.md (API-XXX through API-YYY)`
2. Tell user: `Run /fix-gap API-XXX for one at a time, or /batch-fix for all P0/P1.`

## Rules
- Read every route file and its controller. Don't guess.
- CSRF is global — don't flag per-route unless bypassed.
- Stripe/Apple/Google webhook routes legitimately skip CSRF and auth.
- OAuth callbacks have their own auth flow.
- **Never skip the logging step.**
