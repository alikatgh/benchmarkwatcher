# Native BenchmarkWatcher

The Apple apps use Swift and SwiftUI, with AppKit and UIKit available for
platform-specific work. Android uses Kotlin and Jetpack Compose. The existing
`mobile/` Expo app is a separate earlier implementation; it is not used by these
targets.

## First research flow

Find a company by ticker/name, open a historical financial brief, choose annual,
quarterly or trailing-year values, inspect a value's SEC filing sources, follow
the company, and save a note with its report version and source links. Saved
reports and notes are available offline. Refresh is explicit; changed/new values
compare against a persisted review baseline. Missing financial periods remain
gaps, and a zero value is retained.

Mac has a sidebar, keyboard actions, a source inspector, native financial tables
and separate comparison windows. iPhone uses tab navigation, lists, drill-down
screens and source sheets. Android uses Material navigation, source sheets and
a list/detail workspace when its window is wide enough.

This increment does not yet include widgets, notification delivery, share
extensions, cloud sync or paid-provider chat. The apps have no bundled AI key or
automatic paid requests. They are development builds, not store releases.

## Backend contract

`GET /api/v1/research/companies?q=AAPL` returns SEC directory matches.
`GET /api/v1/research/companies/0000320193` returns consolidated financial history
and its provenance. See `contracts/research.openapi.yaml`.

The API is public/read-only; it does not return account data or workbook files.
SEC downloads use the existing pacing, cache, timeout and size bounds. Native
report builds have a shared hourly budget (default 120 across workers) and a
per-issuer lease. The native endpoint reads two SEC JSON resources and does not
download filing HTML or invoke AI. Search/report responses carry ETags. Local
libraries do not sync into web accounts.

## Apple

Requires Xcode 15+ (macOS 14+, iOS 17+) and XcodeGen. No external Swift package
downloads are needed.

```sh
cd native/apple
swift test -j 2
xcodegen generate
open BenchmarkWatcher.xcodeproj
```

Choose `BenchmarkWatcherMac` or `BenchmarkWatcherPhone`. Configure your own
development team for device signing. Production targets use
`https://benchmarkwatcher.online`; a Debug launch can pass
`--api=http://127.0.0.1:5002` for a local backend.

For a small Mac preview after `swift test`:

```sh
bash native/scripts/build_mac_preview.sh
open /private/tmp/benchmarkwatcher-native-preview/BenchmarkWatcher.app --args --demo
```

The `--demo` launch uses clearly labeled synthetic financials in a separate
temporary library and makes no SEC requests. Ordinary launch starts with an
empty private library. Optional `--library=/absolute/path/research.json` isolates
a test library. An unreadable library is reported and not automatically replaced.

## Android

Requires JDK 17 or 21, Gradle 8.9–8.11 and Android SDK 35. Set `ANDROID_HOME` to
your SDK, or use an untracked `local.properties` file.

```sh
cd native/android
gradle :app:testDebugUnitTest :app:assembleDebug
```

For an offline check of the pure Kotlin data contract, using already cached
compiler/test jars only:

```sh
python3 native/scripts/check_android_core.py
```

This limited check does not compile the Compose UI or produce an APK.

The APK is a development artifact. There is no EAS dependency or store upload.
The default API is HTTPS; changing `researchApiUrl` is a development configuration
choice. Cleartext traffic is disabled by the application manifest.

## Assets and fixtures

The checked-in icon sizes derive from the approved `mobile/assets/icon.png`.
Mac assets have transparent outer padding and rounded corners so their optical
size fits the Dock. iOS retains its opaque asset for the system's icon mask.
Original artwork remains unchanged. To regenerate icon sizes, use a Python
environment with Pillow; fixture generation uses the existing Python app/test
environment and deliberately synthetic SEC-shaped data:

```sh
python3 native/scripts/prepare_assets.py --icons-only
.venv/bin/python native/scripts/prepare_assets.py --fixtures-only
```

Do not seed real user research, provider keys or private workbooks in app bundles.
Respect the Mac's disk/simulator budget before device validation or archives.
