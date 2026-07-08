# Security Audit Round Status — BenchmarkWatcher

Track security audit rounds, remediation, and re-verification.

---

## Current Round

| Field | Value |
|-------|-------|
| **Active round** | r2 (tests) |
| **Audit date** | 2026-07-06 |
| **Report** | [`2026-07-06-r2-benchmarkwatcher-tests.md`](./2026-07-06-r2-benchmarkwatcher-tests.md) |
| **Mode** | Read-only |
| **Status** | **Complete — 10 test-gap findings logged** |

### r2 tests summary

| Severity | Count |
|----------|------:|
| High | 2 |
| Medium | 4 |
| Low | 4 |

**Top gaps:** commodity template XSS + `include_history` abuse untested; mobile jest omitted from CI; rate limits disabled in pytest.

---

## Round 1 (r1) — Security — 2026-07-06

### Scope

- Authentication (internal API key, bot tokens, absence of user auth)
- API routes (`/api/*`, `/internal/api/*`, HTML pages)
- Data fetching (server JSON reads, fetchers, web AJAX, mobile client)
- XSS in charts, tables, templates, `innerHTML` renderers
- Environment secrets (`.env`, examples, gitignore)
- CORS policy
- Dependency exposure (Python pins, npm/mobile lockfile, vendored JS)

### Findings Summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| SEC-R1-001 | 🟡 Medium | Inline Jinja→JS XSS on commodity detail page | **open** |
| SEC-R1-002 | 🟡 Medium | CSP `unsafe-inline` weakens XSS containment | **open** |
| SEC-R1-003 | 🟡 Medium | Per-process rate limits under gunicorn (2× effective quota) | **open** |
| SEC-R1-004 | 🟡 Medium | Unbounded `include_history=1` on public list API | **open** |
| SEC-R1-005 | 🟢 Low | `category` param not allowlisted | **open** |
| SEC-R1-006 | 🟢 Low | Missing HSTS at app layer | **open** |
| SEC-R1-007 | 🟢 Low | Ephemeral `SECRET_KEY` if env unset | **open** |
| SEC-R1-008 | 🟢 Low | Dev server `0.0.0.0` bind + opt-in debug | **open** |
| SEC-R1-009 | 🟢 Low | Weak `INTERNAL_API_KEY` placeholder in examples | **open** |
| SEC-R1-010 | 🟢 Low | Mobile transitive npm deprecation warnings | **open** |

**Totals:** 0 critical · 4 medium · 5 low · 10 open

### Remediation

| Action | Owner | Target | State |
|--------|-------|--------|-------|
| Fix SEC-R1-001 (tojson / data-* init pattern) | — | r2 | not started |
| Cap or throttle `include_history=1` | — | r2 | not started |
| Shared rate-limit storage for prod | — | backlog | not started |
| CSP nonce migration | — | backlog | not started |
| Log SEC-* to `KNOWN_UI_DEBT.md` | — | optional | not started |

### Re-verification Checklist (for r2)

- [ ] `commodity.html` has no raw `{{ }}` inside `<script>` or `onclick` handlers
- [ ] Regression test with quote/backslash in commodity `name`/`currency`
- [ ] `include_history=1` response size bounded or rate-limited separately
- [ ] `RATELIMIT_STORAGE_URI` documented/set for multi-worker deploy
- [ ] `npm audit` run in `mobile/` with actionable output recorded

---

## Round History

| Round | Date | Lens | Report | Critical | High | Medium | Low | Outcome |
|-------|------|------|--------|----------|------|--------|-----|---------|
| r2 | 2026-07-06 | tests | [2026-07-06-r2-benchmarkwatcher-tests.md](./2026-07-06-r2-benchmarkwatcher-tests.md) | 0 | 2 | 4 | 4 | Test-gap audit complete |
| r1 | 2026-07-06 | security | [2026-07-06-r1-benchmarkwatcher-security.md](./2026-07-06-r1-benchmarkwatcher-security.md) | 0 | — | 4 | 5 | Baseline security audit complete |

---

## Next Round Planning

**Suggested r2 focus (after P1 fixes):**

1. Re-scan `commodity.html` and all templates for inline JS interpolation
2. Abuse testing: rate limits + large payload endpoints under gunicorn (2 workers)
3. Mobile dependency audit (`npm audit`, Expo SDK changelog)
4. Confirm HSTS/CSP headers at Caddy edge in production

---

*Last updated: 2026-07-06*