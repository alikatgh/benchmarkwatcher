---
title: "Tests Audit — benchmarkwatcher"
repo: benchmarkwatcher
lens: tests
date: 2026-07-06
round: 2
mode: read-only
audience: Claude implementation sessions
---

# Tests Audit — BenchmarkWatcher (Round 2)

**Scope:** Python tests (`tests/`, 11 files), Jest (`__tests__/`, 28 files), mobile Jest (`mobile/__tests__/`, 10 files), Playwright e2e (`tests/e2e/`), CI (`vocab-and-e2e.yml`), BUG_JOURNAL patterns (rendered DOM verification, dual-renderer drift, `dict.get` None fallthrough, CSP CDN injection guard). Cross-referenced r1 security (`2026-07-06-r1-benchmarkwatcher-security.md`, 10 findings).  
**Method:** Read-only mapping of tests to r1 findings; grep integration tests for XSS/history/rate-limit; review CI job matrix vs package scripts.  
**Prior work:** June 2026 wave-3b added bot/fetcher regression tests, `no-raw-floats` e2e, CSP CDN injection scan, non-ASCII internal-key 403 test. This round focuses on **gaps that let r1 availability and XSS findings return unnoticed**.

---

## Executive Summary

| Severity | Count | Top risk |
|----------|------:|----------|
| **HIGH** | 2 | Commodity template XSS (r1-001) and `include_history` abuse (r1-004) lack regression guards |
| **MEDIUM** | 4 | Rate limits disabled in tests; mobile suite omitted from CI; category allowlist untested |
| **LOW** | 4 | CSP strength; e2e commodity coverage; coverage metrics; multi-worker limit semantics |

**Total verified findings:** 10

The project has **mature client test discipline** (jest lifecycle/race suites, `compactTableApplyVisualSettings` dual-renderer pins, Playwright DOM float scan). Server-side security regressions from r1 are **under-tested** relative to data-pipeline and bot hardening.

---

## Cross-Reference: r1 Security → r2 Test Coverage

| r1 ID | Finding | r2 test status |
|-------|---------|----------------|
| SEC-R1-001 | Inline Jinja→JS XSS on commodity detail | **OPEN** — no template/response test with quote/backslash in `name`/`currency` |
| SEC-R1-002 | CSP `unsafe-inline` | **PARTIAL** — CDN injection guarded; CSP string not asserted |
| SEC-R1-003 | Per-process rate limits under gunicorn | **OPEN** — `conftest.py` sets `RATELIMIT_ENABLED = False` |
| SEC-R1-004 | Unbounded `include_history=1` | **OPEN** — tests toggle flag; no payload size cap |
| SEC-R1-005 | `category` param not allowlisted | **OPEN** — no negative test |
| SEC-R1-006–010 | Low / informational | **Accepted** — HSTS/SECRET_KEY/dev bind/mobile npm — no automated guards expected |

---

## HIGH

### H1 — No regression test for commodity detail inline-JS XSS (SEC-R1-001)

- **Files:** `app/templates/commodity.html:79`, `:1094`; **safe pattern:** `:1078` (`history | tojson`)
- **Symptom:** `copyPrice('{{ commodity.price }} {{ commodity.currency }}')` and `BW.Commodity.init(..., '{{ commodity.name }}', …)` embed untrusted JSON fields in inline JS/event handlers.
- **Root cause:** Grep `tests/` → zero matches for `commodity.html`, `BW.Commodity.init`, `copyPrice`. Jest `commodity.test.js` tests client modules, not server-rendered template output.
- **Fix direction:** Fixture commodity in `data/` with `name` containing `');alert(1);//`; `app_client.get("/commodity/<id>")` asserts no unescaped breakout in `<script>` / `onclick` (or migration to `tojson` / `data-*` init).
- **Tags:** `tests` `verified` `xss` `regression` `STILL-PRESENT`

### H2 — `include_history=1` list endpoint has no abuse/size regression (SEC-R1-004)

- **Files:** `app/routes.py:163-166`; tests: `test_routes_integration.py:133-138`
- **Symptom:** Public clients can request full multi-year history for all commodities — multi-MB responses; grid/compact always fetch with history on range change.
- **Root cause:** Integration test asserts `include_history=true` returns 200 and meta flag; **no assertion** on serialized byte size, point cap, or degraded sparkline mode.
- **Fix direction:** After server cap lands, test `len(resp.data) < N` for list+history; or test 413/422 when over threshold.
- **Tags:** `tests` `verified` `dos` `api` `STILL-PRESENT`

---

## MEDIUM

### M1 — Flask rate limiting disabled in pytest (masks SEC-R1-003)

- **File:** `tests/conftest.py:72` — `RATELIMIT_ENABLED = False`
- **Symptom:** r1 documents 2× effective quota under gunicorn `workers=2` with `memory://` storage; tests never exercise 429 behavior on public API.
- **Root cause:** Intentional for test stability; no separate job validates limiter wiring or shared storage config.
- **Fix direction:** Isolated test class with limiter enabled + `limiter.reset()` in teardown; optional marker for multi-worker integration (documented halved limits).
- **Tags:** `tests` `verified` `rate-limit` `false-negative`

### M2 — Mobile Jest suite not executed in CI workflow

- **Files:** `mobile/__tests__/` (10 files); `.github/workflows/vocab-and-e2e.yml` — `npm test` at repo root only
- **Symptom:** BUG_JOURNAL NativeWind preset trap — bundle failures invisible to root jest; mobile API contract tests (`commoditiesAPI.test.ts`) skipped in CI.
- **Root cause:** No `cd mobile && npm test` (or workspace) step in workflow.
- **Fix direction:** Add `mobile-tests` job: `npm ci` in `mobile/`, `npm test`.
- **Tags:** `tests` `verified` `ci` `mobile`

### M3 — `category` query param allowlist untested (SEC-R1-005)

- **File:** `app/routes.py` (category filter)
- **Symptom:** Unexpected category strings may affect cache keys or filter logic — r1 LOW but untested.
- **Fix direction:** Parametrize test: valid categories 200; garbage category → 400 or ignored per policy.
- **Tags:** `tests` `verified` `validation`

### M4 — CSP policy strength not regression-tested (SEC-R1-002)

- **File:** `app/__init__.py:88-97`
- **Symptom:** `script-src 'self' 'unsafe-inline'` weakens XSS containment; r1 notes CDN correctly removed.
- **Root cause:** `test_routes_integration.py` scans static JS for CDN `script.src` injection (good); **no test** asserts CSP header contents or absence of `unsafe-inline` once tightened.
- **Fix direction:** Snapshot test on `GET /` response headers; fail if `unsafe-inline` reappears after nonce migration.
- **Tags:** `tests` `verified` `csp`

---

## LOW

### L1 — Playwright e2e does not visit commodity detail XSS surface

- **Files:** `tests/e2e/` (market-pulse, a11y, no-raw-floats); r1 re-verification checklist item 2
- **Symptom:** E2e covers index/grid/compact floats; commodity detail inline script path unvisited.
- **Fix direction:** E2e smoke on `/commodity/<fixture-id>` with poisoned name in test data.
- **Tags:** `tests` `verified` `e2e`

### L2 — No unified coverage reporting across Python + Jest

- **Files:** CI runs pytest + jest separately; no combined threshold
- **Symptom:** New routes can ship with zero Python tests if author skips discipline.
- **Tags:** `tests` `verified` `coverage`

### L3 — `test:all` script exists but CI splits jobs without explicit depend

- **File:** `package.json:8` (`test:all`); CI: separate `unit-tests` + `e2e-tests` + `python-tests`
- **Symptom:** Acceptable — all three run on PR. Mobile still missing (M2).
- **Tags:** `tests` `verified` `ci`

### L4 — Internal API key tests strong; list-endpoint auth N/A correctly untested

- **Files:** `test_routes_integration.py:172-193`, `test_routes_helpers.py:48`
- **Note:** Positive control — non-ASCII key → 403 regression exists (BUG_JOURNAL pattern).
- **Tags:** `tests` `verified` `strength`

---

## Controls Verified Sound (no finding)

| Control | Location | Notes |
|---------|----------|-------|
| Non-ASCII internal key → 403 | `test_routes_integration.py:192-193` | SEC-R1-adjacent; no 500 |
| CDN script injection scan | `test_routes_integration.py` (CSP-blocked CDN) | BUG_JOURNAL pattern |
| Shared commodity record builder | `test_fetcher_helpers.py`, `test_fetch_daily_data_dispatch.py` | Headline/history drift guard |
| Bot None-coercion | `test_bot_data_reader.py` | `dict.get` None trap |
| Dual-renderer visual settings | `compactTableApplyVisualSettings.test.js` | Renderer drift |
| Raw float DOM scan | `tests/e2e/no-raw-floats.spec.ts` | Post client re-render |
| `safe_get` session + size cap | `test_fetcher_helpers.py` | 10 MB cap |
| `calculateMA` sliding window | `utilsExtended.test.js` | 2026-06-22 regression |
| Vocab scan CI | `vocab-and-e2e.yml` | Content policy |

---

## Test Inventory Snapshot

| Layer | Test files | CI runs? |
|-------|------------|----------|
| Python pytest | 11 `tests/test_*.py` | ✅ `python-tests` job |
| Web Jest | 28 `__tests__/*.js` | ✅ `unit-tests` job |
| Mobile Jest | 10 `mobile/__tests__/*` | ❌ |
| Playwright e2e | `tests/e2e/` | ✅ `e2e-tests` job |
| Vocab script | `scripts/check-vocab.js` | ✅ `vocab-scan` job |

---

## Remediation Priority (for Claude)

1. **P0 — H1:** Commodity template XSS fixture test (r1 re-verification checklist).
2. **P0 — H2:** `include_history` response size cap test.
3. **P1 — M2:** Mobile jest in CI.
4. **P1 — M1:** Opt-in rate-limit behavioral test (limiter enabled).
5. **P2 — M3 + M4:** Category allowlist + CSP header snapshot.

---

*Read-only audit. No application source modified.*