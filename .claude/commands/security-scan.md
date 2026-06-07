# /security-scan [scope]

## Purpose
Security audit for both client and server. You are a security engineer checking for OWASP Top 10 vulnerabilities, auth weaknesses, injection risks, and secrets exposure.

**Every issue found gets logged to `docs/KNOWN_UI_DEBT.md` as SEC-* issues so they can be fixed by `/fix-gap` or `/batch-fix`.**

## Arguments
- Optional: `client`, `server`, or `all`. Defaults to `all`.

## Checks

### Server Security
- **NoSQL injection** — user input in Mongoose queries without sanitization.
- **Command injection** — `exec()`, `spawn()`, `eval()` with user input.
- **XSS via API** — user content returned without sanitization.
- **Path traversal** — file paths from user input.
- **JWT secret strength** — real secret or dev placeholder?
- **Token expiry** — verify refresh flow.
- **Password hashing** — bcrypt rounds ≥ 10.
- **OAuth state validation** — CSRF nonce on OAuth flows.
- **Authorization checks** — can user A modify user B's resources?
- **Account enumeration** — login/register reveals email existence?
- **Sensitive fields in responses** — password hash, tokens leaked?
- **Console.log with PII** — user data in logs?
- **Secrets in code** — hardcoded API keys?
- **CORS permissiveness** — wildcard or too broad?
- **Session config** — secure cookies, httpOnly, sameSite?

### Client Security
- **`dangerouslySetInnerHTML`** without DOMPurify.
- **User content rendering** without escaping.
- **URL handling** — open redirect via user URLs.
- **API keys in client code** beyond public keys.
- **Tokens in localStorage** vs sessionStorage/httpOnly.
- **Auth state manipulation** via devtools.
- **Route protection** — client-side only or server-side too?
- **Deep link validation** — whitelist check.

## Output Format

Print the report, THEN log issues.

```
## Security Scan Report

### 🔴 Critical (fix immediately)
| # | Category | Location | Issue | Fix |

### 🟡 Medium (fix soon)
| # | Category | Location | Issue | Fix |

### 🟢 Low (best practice)
| # | Category | Location | Issue | Fix |

### ✅ Good Practices Found
[Acknowledge security measures already in place]
```

## Post-Audit: Log Issues to KNOWN_UI_DEBT.md (MANDATORY)

After printing the report, WRITE every issue to `docs/KNOWN_UI_DEBT.md`.

### Severity mapping
- 🔴 Critical (exploitable) → **P0**
- 🟡 Medium (needs conditions to exploit) → **P1**
- 🟢 Low (best practice) → **P2**

### Issue ID format: `SEC-001`, `SEC-002`, etc.

### Each issue entry:
```markdown
### SEC-XXX: [issue title]
- **Priority:** P0 / P1 / P2
- **File:** [relative path]:[line number]
- **Category:** injection / auth / xss / secrets / config
- **What:** [1-2 sentence description]
- **Fix:** [concrete fix]
- **Status:** open
- **Found:** [YYYY-MM-DD]
```

### After writing:
1. Print: `Logged X issues to KNOWN_UI_DEBT.md (SEC-XXX through SEC-YYY)`
2. Tell user: `Run /fix-gap SEC-XXX for one at a time, or /batch-fix for all P0/P1.`

## Rules
- Read actual code. Every finding must include file:line.
- Don't flag things already mitigated.
- Stripe webhooks intentionally skip CSRF — correct, not a vulnerability.
- Public keys in client code are fine.
- Focus on exploitable issues, not theoretical.
- **Never skip the logging step.**
