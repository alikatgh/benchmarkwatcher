# Store Release Commands

This project is configured for EAS production builds with:
- iOS bundle id: `com.benchmarkwatcher.mobile`
- Android package: `com.benchmarkwatcher.mobile`
- Production API: `https://benchmarkwatcher.online` via the public
  `EXPO_PUBLIC_API_URL` value in `eas.json`.

## 1) One-time setup

Developer-only note: `npm run eas:login` is required only for maintainers publishing builds.
End users of the app do not need to create accounts or log in.

```bash
cd mobile
npm install
npm run eas:login
```

`npm run api:set` updates `app.json`, the production EAS profile, `.env.example`,
and the local `.env` if the public API URL changes later.

## 2) Verify config before building

```bash
npm run preflight:release
npx expo config --type public
npm run typecheck
npm run test:ci
```

## 2.5) Prepare store metadata

- iOS: use `APP_STORE_METADATA_TEMPLATE.md`
- Android: use `PLAY_STORE_METADATA_TEMPLATE.md`

## 3) Build binaries

The production EAS profile supplies the public API URL at build time. Verify
that it matches the live HTTPS API before building:

```bash
npm run eas:build:ios
npm run eas:build:android
```

## 4) Submit to stores

```bash
npm run eas:submit:ios
npm run eas:submit:android
```

## Notes
- `EXPO_PUBLIC_API_URL` is a public build-time value, not a secret. Provider
  keys and store credentials must never be placed in it or committed to source.
- If `eas submit` asks for missing credentials/metadata, complete them in App Store Connect / Google Play Console.
- For first iOS submission, ensure app record exists in App Store Connect.
- For first Android submission, ensure app exists in Play Console and service account access is configured for automated submit.

## Common preflight blockers

- `Production EAS API URL is missing or invalid`
	- Set the public HTTPS API URL in `build.production.env.EXPO_PUBLIC_API_URL` in `eas.json`.
- `EAS CLI is not logged in`
	- Run `npm run eas:login` (developer/maintainer only, not app users).
- Preflight still failing
	- Re-run `npm run preflight:release` and follow each printed `Fix:` line.

The store listing templates still need verified support and privacy-policy URLs
before submission. Do not publish the old `benchmarkwatching.com` placeholders.
