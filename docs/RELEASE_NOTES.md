# Release Notes

## 2026-10-02 — SEC company research and D3 throughout

### Company research
- Search by company name, ticker or SEC CIK and save a report from supported public disclosures.
- Explore annual, quarterly and trailing-year statements, supported business breakdowns and sector-specific rows.
- Inspect exact values, calculation methods and filing evidence; retain source information in CSV exports.
- Ask built-in metric questions without an AI key, or explicitly share evidence with an optional connected provider.
- Keep conversation beside the report on desktop, with a separate conversation view on smaller screens. Drafts survive minimize/reopen and saved answers remain with the report.
- Group business disclosures by axis and offer a useful alternative when a statement frequency has no values.

### Visuals and interface
- All web data charts use self-hosted D3, including benchmark histories, sparklines, comparison views, company/workbook results and category breadth bars. Removed the unused Chart.js bundles.
- Added distributions, cumulative views, range/quartiles, monthly averages, heatmaps and observation coverage, plus catalogue-wide change and coverage views.
- Preserve source dates, missing-value gaps, exact-value tables, keyboard inspection and supported chart exports.
- Reduced oversized report headings, chart controls and dashboard summaries; refined sidebar icons and theme colors.

### Guides
- [Company research walkthrough](https://benchmarkwatcher.online/blog/company-research-from-sec-filings)
- [D3 charts and visual explorer](https://benchmarkwatcher.online/blog/d3-charts-and-visual-explorer)

### Profile and API usage
- Added private request and token statistics, provider breakdowns and estimated USD costs to Profile.
- Count provider connection tests and failed calls; mark missing usage and unknown prices as unavailable.
- Recover available tokens from earlier saved answers without inventing historical costs.
- Enforce a per-user rolling request limit at the network boundary, with controls to lower it or pause paid AI.
- Explain free SEC access, provider billing, estimate limitations and separate hosting costs. See [API usage](API_USAGE.md).

These are web application changes. They do not announce a new mobile store release.

## 2026-02-28 — Store readiness + API hardening

Commit: `ba50899`

### Summary
This release prepares the mobile app and backend for production publishing while keeping the project compatible with a no-extra-services deployment model.

### Mobile (Expo / React Native)
- Added production-ready app metadata and release scaffolding for iOS and Android.
- Added EAS build and submit workflow files/scripts and release command docs.
- Added App Store and Google Play metadata templates.
- Added privacy disclosure draft and release checklist.
- Switched to BYO API model (no hardcoded shared public API endpoint).
- Fixed TypeScript test typing issue in `useCommodities` tests.
- Updated TypeScript project config to avoid node_modules diagnostic noise.

### Backend (Flask)
- Added Flask-Limiter integration in app extensions and app factory.
- Applied route-level limits to:
  - `/api/commodities`
  - `/api/commodity/<id>`
  - `/internal/api/commodities`
- Added config-based rate limit defaults via environment variables.
- Kept deployment compatible with in-memory limiter storage (`memory://`) to avoid extra services.

### Security / Operations Docs
- Added API hardening guide with threat model, controls, checklist, and incident response basics.
- Added no-extra-services safety defaults to README and deployment docs.
- Linked security policy to operational hardening guidance.

### Default Safety Environment Variables
```dotenv
RATELIMIT_STORAGE_URI=memory://
PUBLIC_API_LIST_RATE_LIMIT=60 per minute
PUBLIC_API_DETAIL_RATE_LIMIT=120 per minute
INTERNAL_API_RATE_LIMIT=30 per minute
INTERNAL_API_KEY=change_me
```

### Validation Status
- Mobile `npm run typecheck`: pass
- Mobile `npm run test:ci`: pass (5 suites, 21 tests)
- Expo public config check: pass

### Notes
- For store publishing, set your own production API endpoint via `EXPO_PUBLIC_API_URL`.
- This repo intentionally does not ship a shared public API endpoint by default.
