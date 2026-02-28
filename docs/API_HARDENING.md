# API Hardening Guide (Open Source / Public Clients)

This project is open source and mobile binaries are public, so API endpoints should be treated as discoverable.

## Threat Model

Assume external users can:
- Find your API domain
- Replay requests from scripts/bots
- Generate high request volume

Protect cost and availability with server-side controls, not hidden client configuration.

## Minimum Controls (Recommended)

1. Rate limiting per IP and per route
2. API key or token gate for non-public endpoints
3. Response caching for expensive/read-heavy endpoints
4. Request timeouts and payload size limits
5. Logging and alerting on spikes/error rates

## Suggested Limits (Starting Point)

Tune for your traffic profile.

- Anonymous read endpoints: 60 requests/min/IP
- Burst cap: 120 requests/min/IP
- Heavy endpoints (history, compare): 20 requests/min/IP
- Global per-key quota (if using keys): daily cap by plan

## Current App Defaults

This repository now enforces rate limits on key API endpoints via Flask-Limiter.

- `/api/commodities` → `PUBLIC_API_LIST_RATE_LIMIT` (default: `60 per minute`)
- `/api/commodity/<id>` → `PUBLIC_API_DETAIL_RATE_LIMIT` (default: `120 per minute`)
- `/internal/api/commodities` → `INTERNAL_API_RATE_LIMIT` (default: `30 per minute`)

Related environment variables:

- `RATELIMIT_STORAGE_URI` (default: `memory://`)
- `RATELIMIT_HEADERS_ENABLED` (default: enabled)

## Flask Example: Rate Limiting

```python
from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["60 per minute"],
    storage_uri="memory://"
)

@app.route("/api/commodities")
@limiter.limit("30 per minute")
def commodities():
    ...
```

This project can run entirely with in-memory limiter storage (`memory://`) and no external services.

## Caching Strategy

For benchmark data that changes on fixed intervals, cache read responses.

- Cache `GET /api/commodities` for 30-300s
- Cache `GET /api/commodity/<id>` for 30-300s
- Add cache-control headers aligned with update frequency
- Invalidate cache on data refresh jobs

## No-Extra-Services Operating Mode

If you do not want any additional services:
- Keep `RATELIMIT_STORAGE_URI=memory://`
- Keep conservative per-route limits enabled
- Keep internal endpoint protected with `INTERNAL_API_KEY`
- Prefer short response payloads and cached reads

## API Keys in Open Source Context

If you issue API keys:
- Never embed privileged keys in client apps
- Treat mobile-distributed keys as public
- Use key tiers with strict quotas and rotation
- Revoke abused keys quickly

## Cost Guardrails

- Set hosting/bandwidth budget alerts
- Alert on request-rate anomalies and 5xx spikes
- Fail closed on quota exhaustion for non-critical routes
- Prefer stale cache over uncached expensive recomputation

## Ops Checklist Before Public Launch

- [ ] Per-route rate limits configured
- [ ] Cache enabled for high-traffic read endpoints
- [ ] Budget alerts configured with low thresholds
- [ ] API key policy documented (if applicable)
- [ ] Abuse response runbook documented

## Abuse Response Playbook

1. Identify source pattern (IP, ASN, endpoint)
2. Apply temporary edge block/rate reduction
3. Reduce route limits for impacted endpoints
4. Enable/extend cache TTL
5. Reassess and refine permanent rules

## Notes

Hiding API domains in client apps does not provide security. For open-source mobile apps, resilient server controls are the reliable way to control cost and abuse.
