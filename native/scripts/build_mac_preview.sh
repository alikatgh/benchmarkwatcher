#!/bin/bash
# Small local preview build. No Xcode archive, simulator, downloads or signing account.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
apple_root="$project_root/native/apple"
task_build="$apple_root/.build"
# Keep the runnable bundle outside File Provider-managed project folders.
preview_app="${BW_PREVIEW_APP:-/private/tmp/benchmarkwatcher-native-preview/BenchmarkWatcher.app}"
cd "$apple_root"
mkdir -p "$preview_app/Contents/MacOS" "$preview_app/Contents/Resources" "$task_build/Preview.iconset"
xcrun swiftc -D DEBUG -parse-as-library -target arm64-apple-macosx14.0 \
  -module-cache-path "$task_build/ModuleCache" \
  -I "$task_build/arm64-apple-macosx/debug/Modules" \
  App/BenchmarkWatcherApp.swift App/ResearchStore.swift App/SharedViews.swift App/MacWorkspace.swift App/PhoneRoot.swift \
  "$task_build"/arm64-apple-macosx/debug/ResearchCore.build/*.o \
  -o "$preview_app/Contents/MacOS/BenchmarkWatcher"
cp -X Tests/ResearchCoreTests/Fixtures/report.json "$preview_app/Contents/Resources/report.json"
for size in 16 32 128 256 512; do
  cp -X "Assets.xcassets/AppIcon.appiconset/mac-$size@1x.png" "$task_build/Preview.iconset/icon_${size}x${size}.png"
  cp -X "Assets.xcassets/AppIcon.appiconset/mac-$size@2x.png" "$task_build/Preview.iconset/icon_${size}x${size}@2x.png"
done
python3 - "$preview_app" "$task_build/Preview.iconset" <<'PY'
import plistlib, struct, sys
from pathlib import Path
app = Path(sys.argv[1])
icons = Path(sys.argv[2])
chunks = []
for kind, name in [('ic07', 'icon_128x128.png'), ('ic08', 'icon_256x256.png'), ('ic09', 'icon_512x512.png'), ('ic10', 'icon_512x512@2x.png')]:
    data = (icons/name).read_bytes()
    chunks.append(kind.encode('ascii') + struct.pack('>I', len(data)+8) + data)
body = b''.join(chunks)
(app/'Contents/Resources/AppIcon.icns').write_bytes(b'icns' + struct.pack('>I', len(body)+8) + body)
info = {'CFBundleIdentifier': 'com.benchmarkwatcher.mac.preview', 'CFBundleExecutable': 'BenchmarkWatcher',
        'CFBundleName': 'BenchmarkWatcher', 'CFBundleDisplayName': 'BenchmarkWatcher', 'CFBundlePackageType': 'APPL',
        'CFBundleVersion': '1', 'CFBundleShortVersionString': '0.1.0', 'CFBundleIconFile': 'AppIcon',
        'LSMinimumSystemVersion': '14.0', 'NSHighResolutionCapable': True}
with (app/'Contents/Info.plist').open('wb') as output: plistlib.dump(info, output)
PY
codesign --sign - --force "$preview_app"
printf '%s\n' "$preview_app"
