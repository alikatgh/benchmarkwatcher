# Store Release Commands

This project is configured for EAS production builds with:
- iOS bundle id: `com.benchmarkwatcher.mobile`
- Android package: `com.benchmarkwatcher.mobile`
- Production API: `EXPO_PUBLIC_API_URL` (bring your own HTTPS API)

## 1) One-time setup

```bash
cd mobile
npm install
npm run eas:login
cp .env.example .env
# then edit .env and set EXPO_PUBLIC_API_URL=https://your-api-domain.example
```

## 2) Verify config before building

```bash
npx expo config --type public
npm run typecheck
npm run test:ci
```

## 2.5) Prepare store metadata

- iOS: use `APP_STORE_METADATA_TEMPLATE.md`
- Android: use `PLAY_STORE_METADATA_TEMPLATE.md`

## 3) Build binaries

Set API URL for EAS builds (recommended one-time project secret):

```bash
cd mobile
npx eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value https://your-api-domain.example
```

Then build:

```bash
npm run eas:build:ios
npm run eas:build:android
```

## 4) Submit to stores

```bash
npm run eas:submit:ios
npm run eas:submit:android
```

## Optional: force runtime API URL without changing eas.json

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://your-api-domain.example eas build -p ios --profile production
EXPO_PUBLIC_API_URL=https://your-api-domain.example eas build -p android --profile production
```

## Notes
- This repository does not ship a shared public API endpoint by default.
- If `eas submit` asks for missing credentials/metadata, complete them in App Store Connect / Google Play Console.
- For first iOS submission, ensure app record exists in App Store Connect.
- For first Android submission, ensure app exists in Play Console and service account access is configured for automated submit.
