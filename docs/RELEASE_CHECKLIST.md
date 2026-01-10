# BenchmarkWatcher Release Checklist

Use this checklist before tagging or deploying a new version.

## Semantic Compliance

- [ ] All UI labels reviewed against [`docs/ui-vocabulary.md`](./ui-vocabulary.md)
- [ ] No forbidden terms (return, trend, signal, forecast, etc.) in UI text
- [ ] README disclaimer matches UI wording

## Automated Tests

- [ ] Unit tests pass: `npm test`
- [ ] E2E tests pass: `npm run test:e2e`
- [ ] Axe accessibility test green (no critical violations)
- [ ] Disclaimer safety test green (no forbidden terms)

## Visual Quality

- [ ] Visual regression screenshots reviewed (if running with `--update-snapshots`)
- [ ] All themes render correctly (light, dark, bloomberg, etc.)
- [ ] Grid and compact views display properly

## Production Readiness

- [ ] No console warnings in prod mode (`BW_ENV=prod`)
- [ ] Dependencies pinned in `requirements.txt` / `package.json`
- [ ] No debug `console.log` statements in production code

## Security

- [ ] No hardcoded secrets or API keys
- [ ] HTTPS enforced in production config
- [ ] Input sanitization in place

## Data Integrity

- [ ] No runtime calculations added to UI (display only)
- [ ] API responses validated (defensive guards in place)
- [ ] Empty/error states handled gracefully

---

## Pre-Deploy Commands

```bash
# Run all tests
npm test && npm run test:e2e

# Verify no console warnings in browser
# Open http://127.0.0.1:5000 with DevTools console open

# Check for forbidden terms
grep -rE "(trend|signal|forecast|buy|sell)" app/templates/ app/static/js/
```

---

*Last updated: 2026-01-10*
