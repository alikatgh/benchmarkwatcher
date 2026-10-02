# BenchmarkWatcher icon brief

Status: selected and integrated on October 2, 2026. Mobile binary distribution is a separate release step. The production source is `design/benchmarkwatcher-icon-chatgpt-source.png`, copied from the user's ChatGPT download without altering the file in Downloads. Its SHA-256 is `6b2c03b3ffe785c11ffa15d7f3c43c7fedbb3cc8a820a4791531cd7a93ca4be6`.

## Purpose

BenchmarkWatcher helps people inspect historical benchmark observations and public company disclosures. The mark should suggest a reliable reference point and repeated observations, not a stock tip or an upward price promise. It must work in the web header, browser tab, mobile home screen, and small social avatars.

## Prompt supplied for ChatGPT generation

> **BenchmarkWatcher — primary icon. Generate the image now.** Design one original symbol for a research product built around historical commodity benchmarks and public company filings. The idea is a fixed reference point and repeated observations. Reduce it to a bold, memorable geometric mark with clever negative space; a subtle abstract “B” is welcome, but it must not look like a typed letter. Aim for the simplicity and visual wit of classic modernist identity design without copying Paul Rand or any existing logo. Make it legible at 16 × 16 pixels and balanced in a square. Use a single solid color, clean edges, and substantial shapes. No text, arrows, charts, candlesticks, currency symbols, eyes, magnifying glasses, gradients, shadows, texture, rounded-square app tile, or mockup. Output one centered 1024 × 1024 PNG with a transparent background and comfortable padding. Show only the symbol.

The selected result is a B-shaped form with a vertical reference stem and three circular points. Its source has a transparent background. Production exports use the same alpha silhouette, trimmed to the visible shape and scaled for each context; the Downloads original is retained.

## Asset and usage map

- Web header: `app/templates/components/header.html` uses `app/static/images/brand-mark-white.png` on a claret tile.
- Browser: `app/static/images/favicon.png`, `favicon.ico`, and `apple-touch-icon.png` are dedicated icon exports.
- Social: `app/static/images/og-image.png` is a separate 1200 × 630 composition, not a stretched favicon.
- Mobile: `mobile/assets/icon.png`, `adaptive-icon.png`, `favicon.png`, and `splash-icon.png` share the silhouette. The Android foreground leaves adaptive-icon safe space.
- Discord: `bots/discord_bot.py` points to the now-shipped `static/images/favicon.png`.

## Blog story to publish with the asset

The public article is `app/templates/blog/new-icon.html`. It explains why the old letter-and-arrow was replaced and shows the new symbol at app and browser sizes without trading or forecasting claims.

Primary ChatGPT image conversation: user generated the source in ChatGPT.com; conversation URL was not provided.
