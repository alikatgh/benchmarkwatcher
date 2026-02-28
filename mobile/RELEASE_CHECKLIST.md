# Mobile Release Checklist (Google Play + App Store)

## 1) Build/Config
- [ ] Set final app identifiers in `app.json`:
  - iOS `expo.ios.bundleIdentifier`
  - Android `expo.android.package`
- [ ] Confirm semantic version (`expo.version`), iOS `buildNumber`, Android `versionCode`
- [ ] Set `EXPO_PUBLIC_API_URL` to your production HTTPS endpoint (BYO API)
- [ ] Verify `eas.json` production profile is used for release builds

## 2) Store Listing Assets
- [ ] App name and subtitle/title finalized
- [ ] Description and keywords prepared
- [ ] Fill iOS metadata from `APP_STORE_METADATA_TEMPLATE.md`
- [ ] Fill Android metadata from `PLAY_STORE_METADATA_TEMPLATE.md`
- [ ] App icon (1024x1024), splash, and adaptive icon verified
- [ ] Screenshots captured for required device classes
- [ ] Category/content rating completed

## 3) Privacy & Compliance
- [ ] Publish a Privacy Policy URL and add it to App Store/Play Console
- [ ] Complete Apple App Privacy questionnaire
- [ ] Complete Google Play Data Safety form
- [ ] Confirm third-party SDK disclosures (Expo/React Native libraries)
- [ ] Confirm store listing states: no end-user account/login required

## 4) Technical Validation
- [ ] `npm run preflight:release` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test:ci` passes
- [ ] Manual smoke test on iOS + Android release builds
- [ ] Verify deep links/external links and error states

## 5) Submission
- [ ] Build artifacts:
  - iOS: `eas build -p ios --profile production`
  - Android: `eas build -p android --profile production`
- [ ] Upload via `eas submit` or store consoles
- [ ] Roll out staged release / phased release
