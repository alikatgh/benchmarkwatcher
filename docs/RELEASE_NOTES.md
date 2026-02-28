# Release Notes

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
