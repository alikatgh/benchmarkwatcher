# /deploy-check

## Purpose
Check deployment health: CI status, backend and frontend availability. Read-only.

## Steps

1. **GitHub CI status:**
   ```bash
   gh run list --limit 5
   ```
   If any run failed: `gh run view [id] --log-failed` — show the failure summary.

2. **Live URL check** (detect from `SESSION_STATE.md`, `README.md`, or `.env.example`):
   ```bash
   curl -s -o /dev/null -w "%{http_code}" [production-url]
   ```
   200 → UP. Anything else → DOWN with status code.

3. Report:
   ```
   Deployment Status
   ─────────────────
   GitHub CI:   [status] on [branch] ([time ago])
   Backend:     [url] — UP / DOWN (HTTP [code])
   Frontend:    [url] — UP / DOWN (HTTP [code])
   ```

4. If anything is down or failing: provide specific next steps.

## Rules
- Never triggers a deploy. Read-only.
- Requires `gh` CLI. If not available, skip CI check and note it.
- Render / Railway free tiers can cold-start in 10–30s — a slow response is normal, note it.
