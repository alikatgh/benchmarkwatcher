"""Create native sizes from the existing approved icon and synthetic test data.

No image generation, source replacement, network calls or private data reads.
"""
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def main():
    apple = ROOT / 'native/apple'
    if '--fixtures-only' in sys.argv:
        fixtures(apple)
        return
    from PIL import Image, ImageDraw, ImageFilter
    icon = Image.open(ROOT / 'mobile/assets/icon.png').convert('RGB')
    catalogue = apple / 'Assets.xcassets'
    appicon = catalogue / 'AppIcon.appiconset'
    appicon.mkdir(parents=True, exist_ok=True)
    images = []
    # macOS does not apply the iOS launcher mask. Fit the approved artwork into
    # the Dock's optical bounds, leaving transparent corners and outer padding.
    mac_icon = Image.new('RGBA', (1024, 1024))
    mask = Image.new('L', (1024, 1024))
    ImageDraw.Draw(mask).rounded_rectangle((100, 100, 924, 924), radius=184, fill=255)
    shadow = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    shadow.putalpha(mask.filter(ImageFilter.GaussianBlur(12)).point(lambda alpha: round(alpha * .16)))
    mac_icon.alpha_composite(shadow, (0, 8))
    artwork = Image.new('RGBA', (1024, 1024))
    artwork.paste(icon.resize((824, 824), Image.Resampling.LANCZOS), (100, 100))
    artwork.putalpha(mask)
    mac_icon.alpha_composite(artwork)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f'mac-{size}@{scale}x.png'
            mac_icon.resize((size*scale, size*scale), Image.Resampling.LANCZOS).save(appicon / name)
            images.append({'idiom': 'mac', 'size': f'{size}x{size}', 'scale': f'{scale}x', 'filename': name})
    icon.save(appicon / 'ios-1024.png')
    images.append({'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024', 'filename': 'ios-1024.png'})
    (appicon / 'Contents.json').write_text(json.dumps({'images': images, 'info': {'version': 1, 'author': 'xcode'}}, indent=2))
    (catalogue / 'Contents.json').write_text('{"info":{"version":1,"author":"xcode"}}\n')
    accent = catalogue / 'AccentColor.colorset'
    accent.mkdir(exist_ok=True)
    (accent / 'Contents.json').write_text(json.dumps({'colors': [{'idiom': 'universal', 'color': {'color-space': 'srgb', 'components': {'red': '0.094', 'green': '0.353', 'blue': '0.737', 'alpha': '1.000'}}}], 'info': {'version': 1, 'author': 'xcode'}}, indent=2))
    res = ROOT / 'native/android/app/src/main/res'
    for name, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
        folder = res / ('mipmap-' + name)
        folder.mkdir(parents=True, exist_ok=True)
        for variant in ('ic_launcher', 'ic_launcher_round'):
            icon.resize((size, size), Image.Resampling.LANCZOS).save(folder / (variant + '.png'))
    if '--icons-only' not in sys.argv:
        fixtures(apple)


def fixtures(apple):
    # This fixture is deliberately synthetic and appears only in tests or --demo.
    from flask import Flask
    from app import sec_client
    from app.company_financials import build_company_report
    from tests.sec_fixture import CIK, fake_fetch
    sec_client.fetch = fake_fetch
    with Flask(__name__).app_context():
        report = build_company_report(CIK, ticker='DEMO', fetch_documents=False)
    report['company'] = 'Example Devices · Sample data'
    report['industry'] = 'Synthetic financial figures for interface testing'
    report['basis'] = 'Synthetic data for testing only. These figures do not describe a real issuer.'
    for path in [apple / 'Tests/ResearchCoreTests/Fixtures/report.json', ROOT / 'native/android/app/src/test/resources/report.json']:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
