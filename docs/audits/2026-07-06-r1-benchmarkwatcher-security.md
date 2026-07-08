# Security Audit — BenchmarkWatcher (Round 1)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-06 |
| **Round** | r1 |
| **Scope** | Auth, API routes, data fetching, XSS (charts/tables/templates), env secrets, CORS, dependency exposure |
| **Mode** | Read-only (no code changes) |
| **Auditor** | Automated security scan |
| **BUG_JOURNAL** | Reviewed (`docs/BUG_JOURNAL.md`) — prior fixes for non-ASCII internal key, path traversal, CSP CDN injection, and `safe_get` size caps acknowledged |

---

## Executive Summary

BenchmarkWatcher is a **read-only commodity dashboard** with **no end-user authentication**. The intentional security surface is small: public JSON/HTML read endpoints, one shared-secret internal API for bots, and static JSON data files on disk.

**Overall posture: adequate for a public reference-data app**, with several **hardening gaps** around availability abuse (rate-limit storage, heavy API payloads), CSP strength, and one **stored-XSS-class pattern** in a Jinja inline script. No critical remote-code-execution or auth-bypass vectors were found in application code reviewed.

| Severity | Count |
|----------|-------|
| 🔴 Critical (exploitable now, high impact) | 0 |
| 🟡 Medium (needs conditions or moderate impact) | 4 |
| 🟢 Low (best practice / defense-in-depth) | 5 |
| ✅ Good practices | 12 |

---

## Threat Model (as implemented)

| Asset | Exposure | Controls |
|-------|----------|----------|
| Public commodity data | `/`, `/api/commodities`, `/api/commodity/<id>` | Rate limits, caching, input validation on `range`/`since`/`view` |
| Internal bot API | `/internal/api/commodities` | `X-Internal-Key` header, constant-time compare, non-ASCII guard |
| Upstream API keys (FRED/EIA/USDA) | Server `.env` only | `.gitignore` covers `*/.env` |
| Client XSS surface | Jinja templates + `innerHTML` re-renders in grid/compact | Jinja autoescape, `BW.Utils.escapeHtml`, CSP |
| Mobile client | `EXPO_PUBLIC_API_URL` (public by design) | HTTPS enforced in prod builds |

**Not in scope / N/A:** user sessions, OAuth, payments, CSRF on mutations (no mutating public routes), CORS for third-party browsers (same-origin web app).

---

## Findings

### 🟡 SEC-R1-001 — Inline script injection via Jinja string interpolation (stored XSS class)

| | |
|---|---|
| **Severity** | Medium (P1) |
| **Category** | XSS |
| **Location** | `app/templates/commodity.html:79`, `app/templates/commodity.html:1094` |
| **CWE** | CWE-79 |

**What:** Commodity metadata is embedded in inline JavaScript and HTML event handlers using Jinja `{{ ... }}` inside single-quoted JS strings and `onclick` attributes:

```html
<button onclick="copyPrice('{{ commodity.price }} {{ commodity.currency }}')" …>
…
BW.Commodity.init(historyData, '{{ commodity.currency }}', '{{ commodity.name }}', '{{ commodity.id }}');
```

Jinja HTML-autoescape converts `'` → `&#39;`, but HTML5 **decodes character references inside `<script>` and event-handler attributes before JS evaluation**. A poisoned `name` or `currency` in a JSON data file (e.g. `');alert(1);//`) can break out of the string context.

**Contrast (safe pattern already used):** `{{ commodity.history | tojson }}` in `type="application/json"` block at line 1078 correctly JSON-encodes data.

**Exploitability:** Requires control of on-disk commodity JSON (compromised fetcher, malicious deploy, or crafted `data/*.json`). Not directly injectable by anonymous HTTP query params. Client-side `innerHTML` paths **do** escape via `BW.Utils.escapeHtml` — this template path does not.

**Fix:** Pass init config through `tojson` into a `application/json` script tag (same as history), or use `data-*` attributes read via `dataset` + `JSON.parse`. Never interpolate untrusted strings into inline JS. Add a regression test with a fixture commodity containing quotes/backslashes.

---

### 🟡 SEC-R1-002 — CSP allows `unsafe-inline` scripts and styles

| | |
|---|---|
| **Severity** | Medium (P1) |
| **Category** | XSS / config |
| **Location** | `app/__init__.py:88-97` |

**What:** `Content-Security-Policy` includes `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline' …`. Any successful HTML injection (including SEC-R1-001) can execute arbitrary inline script without loading external resources.

**Mitigating context:** Comment documents ~40 inline `style=` attributes and bootstrapping `<script>` blocks as the reason. CDN script-src was correctly removed; vendor bundles are self-hosted (`tests/test_routes_integration.py` + CDN injection scan).

**Fix:** Migrate inline scripts to external files; adopt per-request nonces or hashes for the remaining bootstrap block. Tighten `style-src` once inline styles are reduced.

---

### 🟡 SEC-R1-003 — Per-process rate limiter storage under multi-worker gunicorn

| | |
|---|---|
| **Severity** | Medium (P1) |
| **Category** | Availability / abuse |
| **Location** | `app/extensions.py:6`, `config.py:40`, `gunicorn.conf.py:16-21` |

**What:** Flask-Limiter uses `RATELIMIT_STORAGE_URI=memory://` (default). With gunicorn `workers = 2`, each worker maintains an **independent** counter. A configured `60 per minute` limit effectively allows up to **~120 req/min/IP** across the pool (documented in `gunicorn.conf.py`).

**Impact:** Cost/availability abuse on `/api/commodities` and `/api/commodity/<id>` is easier than documented limits suggest. FileSystemCache **is** shared across workers; only the limiter is affected.

**Fix:** Point `RATELIMIT_STORAGE_URI` at Redis or another shared backend for production multi-worker deploys, **or** document operational limits as per-worker and halve configured values.

---

### 🟡 SEC-R1-004 — Public API allows unbounded `include_history=1` list responses

| | |
|---|---|
| **Severity** | Medium (P1) |
| **Category** | Availability / data fetching |
| **Location** | `app/routes.py:163-166`, `app/static/js/components/compact_table.js:78-85`, `app/static/js/components/grid_view.js:256-265` |

**What:** `GET /api/commodities?include_history=1` returns full filtered history for **all** commodities. Default public API sets `include_history=false`, but:

1. Any client can request `include_history=1` directly.
2. Grid and compact views **always** fetch with `includeHistory: true` on range changes.

With ~70+ commodities and multi-year daily history, responses can be multi-megabyte. Combined with SEC-R1-003, this is a bandwidth/CPU amplification vector (cache helps after first hit; `query_string=True` on list endpoint creates per-param cache entries).

**Fix:** Cap history depth server-side for list endpoints (e.g. last N points for sparklines), require heavier rate limit for `include_history=1`, or split a dedicated lightweight sparkline field. Mobile already uses `include_history=0` (`mobile/api/commodities.ts:41`) — good pattern.

---

### 🟢 SEC-R1-005 — `category` query parameter not allowlisted

| | |
|---|---|
| **Severity** | Low (P2) |
| **Category** | Input validation |
| **Location** | `app/routes.py:160`, `app/routes.py:138-142`, `app/routes.py:233` |

**What:** Unlike `range` and `view`, `category` accepts arbitrary strings. It is echoed in API `meta.category` and used for case-insensitive equality filtering. No SQL/NoSQL/command injection path exists. Risk is limited to confusing clients, cache-key proliferation, and log noise.

**Fix:** Allowlist known category slugs (mirror `mobile/api/commodities.ts::normalizeCategorySlug` or `bots/config.py::CATEGORIES`).

---

### 🟢 SEC-R1-006 — No `Strict-Transport-Security` at application layer

| | |
|---|---|
| **Severity** | Low (P2) |
| **Category** | Transport / headers |
| **Location** | `app/__init__.py:71-98`, `deploy/Caddyfile` |

**What:** Flask sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and CSP, but not HSTS. TLS termination is delegated to Caddy/Cloudflare (appropriate). If the app is ever exposed without TLS at the edge, no HSTS fallback exists.

**Fix:** Add `Strict-Transport-Security` in Caddy config (preferred) or Flask `after_request` when `request.is_secure`.

---

### 🟢 SEC-R1-007 — Ephemeral `SECRET_KEY` when env unset

| | |
|---|---|
| **Severity** | Low (P2) |
| **Category** | Secrets / config |
| **Location** | `config.py:19`, `docs/HETZNER_DEPLOY.md:127-131` |

**What:** `SECRET_KEY = os.environ.get('SECRET_KEY') or secrets.token_hex(32)` regenerates on every process start if unset. Flask sessions are unused for auth, but an unstable key can invalidate signed cookies and any future signed-token use across restarts/workers.

**Fix:** Require explicit `SECRET_KEY` in production (fail boot if missing), as documented for Hetzner deploy.

---

### 🟢 SEC-R1-008 — Dev server binds `0.0.0.0` with opt-in debug

| | |
|---|---|
| **Severity** | Low (P2) |
| **Category** | Config |
| **Location** | `run.py:10-11`, `.env.example:27` |

**What:** `app.run(host="0.0.0.0", port=5002, debug=debug)` exposes the dev server on all interfaces. `FLASK_DEBUG` defaults false, but accidental `FLASK_DEBUG=true` on a LAN/VPS enables the Werkzeug debugger (RCE-class in debug mode).

**Fix:** Default bind to `127.0.0.1` in dev; gate `0.0.0.0` behind an explicit env flag. Never set `FLASK_DEBUG=true` in production (documented).

---

### 🟢 SEC-R1-009 — Weak default `INTERNAL_API_KEY` in examples

| | |
|---|---|
| **Severity** | Low (P2) |
| **Category** | Secrets / operational |
| **Location** | `.env.example:17`, `README.md:76`, `bots/.env.example:9` |

**What:** Documentation and examples use `change_me` as placeholder. If copied to production without rotation, `/internal/api/commodities` is trivially accessible. When unset, endpoint returns 403 (fail-closed) with a startup warning — good.

**Note:** `bots/.env` exists locally with a real key but is **gitignored** (`*/.env` in `.gitignore`) — not a repo exposure; still a workstation hygiene concern.

**Fix:** Deployment checklist already mentions strong key (`docs/DEPLOYMENT.md`). Add provision-time assertion that `INTERNAL_API_KEY != change_me` in prod boot.

---

### 🟢 SEC-R1-010 — Transitive npm deprecation warnings in mobile lockfile

| | |
|---|---|
| **Severity** | Low (P2) |
| **Category** | Dependency exposure |
| **Location** | `mobile/package-lock.json` (transitive `glob`, `tar` deprecated entries) |

**What:** Mobile `package-lock.json` contains multiple deprecated transitive packages flagged for known security fixes in newer majors. Root web `package.json` devDependencies are minimal (jest, playwright, tailwind). No `npm audit` CI gate observed.

**Fix:** Periodic `npm audit` / `npm update` in `mobile/`; consider Dependabot. Expo SDK bumps often refresh transitive trees.

---

## Area-by-Area Review

### Authentication

| Check | Result |
|-------|--------|
| End-user auth | **None** (by design, `SECURITY.md`) |
| Internal API auth | **Present** — `X-Internal-Key`, `secrets.compare_digest`, non-ASCII guard (`app/routes.py:89-100`) |
| Bot tokens | **Server-side only** — `TELEGRAM_BOT_TOKEN` / `DISCORD_BOT_TOKEN` in `bots/.env.example`, gitignored |
| Session cookies | **N/A** — no login flow |

### API Routes

| Route | Auth | Rate limit | Cache | Input validation |
|-------|------|------------|-------|------------------|
| `GET /health` | Public | Exempt | No | N/A |
| `GET /api/commodities` | Public | 60/min (per worker) | 600s, query_string | `range`, `since`, `include_history` validated; `category` freeform |
| `GET /api/commodity/<id>` | Public | 120/min | 600s | ID validated (`_is_safe_commodity_id` + path check) |
| `GET /internal/api/commodities` | API key | 30/min | No | `range` validated |
| `GET /` HTML pages | Public | Default limiter | 600s | `range`, `view` validated |

Error handlers return JSON for `/api/*` paths without stack traces (`app/__init__.py:52-68`).

### Data Fetching (server + client)

| Path | Notes |
|------|-------|
| Server read model | JSON files under `app/data/`; traversal blocked (`app/data_handler.py:412-448`) |
| Fetcher HTTP | `safe_get` — pooled session, 30s timeout, 10 MB cap (`scripts/fetchers/_shared.py:91-125`) |
| Web AJAX | `fetch()` to same-origin `/api/commodities` from grid/compact on range change |
| Mobile | `apiClient` — HTTPS required in prod, 10s timeout, 2 retries (`mobile/api/client.ts`) |

### XSS — Charts & Tables

| Surface | Escaping | Notes |
|---------|----------|-------|
| Jinja templates | Autoescape on `{{ }}` text nodes | Safe for HTML body; **not** safe for inline JS (SEC-R1-001) |
| `compact_table.js` / `grid_view.js` | `BW.Utils.escapeHtml` on commodity fields before `innerHTML` | Consistent pattern |
| `index.js` market pulse | `escapeHtml` / local `esc()` helper | Safe |
| Chart.js (`commodity.js`) | Canvas rendering; history via `tojson` | No `innerHTML` chart labels from raw API in reviewed paths |
| Mobile `SVGLineChart` | React Native SVG `Text` components | No `dangerouslySetInnerHTML` |

### Environment & Secrets

| Check | Result |
|-------|--------|
| `.env` in git | **Ignored** (`*/.env`) |
| `.env.example` | Placeholder keys only |
| API keys in client | **None** — only public `EXPO_PUBLIC_API_URL` |
| Hardcoded secrets in source | **None found** in app/bots Python or web JS |
| `passenger_boot_error.log` | Boot tracebacks only; gitignored pattern via `*.log` |

### CORS

| Check | Result |
|-------|--------|
| `Access-Control-Allow-Origin` | **Not set** — browser defaults to same-origin |
| Mobile native fetch | CORS N/A (not a browser) |
| Assessment | Appropriate for same-origin web + native mobile |

### Dependency Exposure

| Layer | Pinning | Notes |
|-------|---------|-------|
| Python (`requirements.txt`) | Floored + capped majors; Flask `>=3.1.3` for CVE-2026-27205 | No pandas/numpy attack surface |
| Web npm | Dev-only tooling | Small footprint |
| Mobile npm | Expo 54 lockfile | SEC-R1-010 |
| Vendored JS | Chart.js, pptxgen under `app/static/js/vendor/` | CSP-aligned; excluded from CDN injection test |

---

## ✅ Good Practices Observed

1. **Path traversal defense** — `_is_safe_commodity_id` + `_is_path_within_directory` on read paths; unsafe `*.json` filenames skipped in list loader.
2. **Internal key handling** — constant-time compare with non-ASCII pre-check (fixed per BUG_JOURNAL 2026-06-22).
3. **Rate limiting** — Flask-Limiter on public and internal API routes with configurable env limits.
4. **Response caching** — FileSystemCache shared across workers reduces cold-load stampedes.
5. **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
6. **CSP / CDN regression test** — `test_no_static_js_injects_a_csp_blocked_cdn_script`.
7. **Centralized HTML escaping** — `BW.Utils.escapeHtml` used by grid and compact re-renderers.
8. **Safe JSON embedding** — `| tojson` for commodity history payload.
9. **Fetcher hardening** — `safe_get` retries, timeout, response size cap.
10. **Mobile prod guard** — throws if `EXPO_PUBLIC_API_URL` is not HTTPS outside `__DEV__`.
11. **Commodity ID encoding** — `encodeURIComponent` in client-generated links.
12. **Fail-closed internal API** — missing/wrong key → 403, not anonymous access.

---

## Prior BUG_JOURNAL Patterns — Relevance

| Pattern | Status in this audit |
|---------|---------------------|
| CSP CDN script injection | **Mitigated** — self-hosted vendors, regression test green |
| `secrets.compare_digest` non-ASCII | **Fixed** — verified in `is_valid_internal_key` |
| Path traversal / unsafe JSON ids | **Mitigated** — `_is_safe_commodity_id` enforced |
| `dict.get` None fallthrough (bots) | **Out of web scope** — bots hardened separately |
| Mobile `EXPO_PUBLIC_API_URL` prod override | **Operational** — not a vulnerability; documented |

---

## Recommended Fix Priority

| Priority | ID | Action |
|----------|-----|--------|
| 1 | SEC-R1-001 | Eliminate inline Jinja→JS interpolation on commodity detail page |
| 2 | SEC-R1-004 | Server-side cap or throttle for `include_history=1` on list API |
| 3 | SEC-R1-003 | Shared rate-limit backend for multi-worker production |
| 4 | SEC-R1-002 | CSP nonce migration (incremental) |
| 5 | SEC-R1-005–010 | Hardening / hygiene as capacity allows |

---

## Test Coverage Gaps (security-relevant)

- No automated test for inline-script XSS fixtures in `commodity.html`
- No load/abuse test for `include_history=1` response size
- Rate-limit tests not asserting per-worker multiplication under gunicorn
- No `npm audit` in CI for `mobile/`

---

*End of report — Round 1, 2026-07-06*