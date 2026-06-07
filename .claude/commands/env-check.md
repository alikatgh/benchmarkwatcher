# /env-check

## Purpose
Verify environment configuration is complete, consistent, and secure.

## Steps

1. Find `.env.example` or `.env.template`. For each variable check it has a value in `.env` (or shell env).
2. Grep the codebase for:
   - Hardcoded secrets (API keys, passwords, JWT secrets in source files)
   - `.env` committed to git (`git ls-files .env`)
   - Placeholder values: `changeme`, `your-secret-here`, `TODO`, `REPLACE_ME`
   - Secrets exposed via `VITE_` / `NEXT_PUBLIC_` / `REACT_APP_` prefixes
3. Verify JWT secrets, DB URIs, API keys are strong and non-default in production.
4. Log every issue to `docs/KNOWN_UI_DEBT.md` as `ENV-*` with severity P0/P1/P2.

## Output
```
## Environment Configuration Report
### Missing Variables   | Variable | Required | Impact |
### Security Issues     | # | Issue | Location | Fix |
### Summary             | Production ready: YES / NO |
```

## Severity
- Hardcoded secret in source → **P0**
- Missing critical var (DB_URI, JWT_SECRET) → **P0**
- Exposed client-side secret → **P1**
- Missing non-critical var → **P2**

## Rules
- Never print actual secret values.
- `VITE_` / `NEXT_PUBLIC_` vars are browser-visible — flag secrets using those prefixes.
