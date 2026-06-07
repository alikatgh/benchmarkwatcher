# Bug Journal — BenchmarkWatcher

## Patterns to scan for FIRST

- **Mobile won't bundle · "Tailwind CSS has not been configured with the NativeWind preset"** → `mobile/tailwind.config.js` MUST include `presets: [require("nativewind/preset")]` (NativeWind v4). Correct `babel.config.js` + `metro.config.js` + `global.css` is **not** enough. Tests/typecheck pass without it; only a real bundle/render catches it.
- **pytest "No module named pytest"** → run `venv/bin/python -m pytest tests`, NOT the Homebrew `python3` (3.14) which has no pytest. A false-failure trap — the suite is actually green (68 passed).
- **Mobile shows "Server error (500)" but the same URL curls 200 locally** → the app reads `EXPO_PUBLIC_API_URL` from `mobile/.env` (prod = `https://benchmarkwatcher.online`) and ignores localhost. To test against local Flask, point `mobile/.env` at `http://localhost:5002`, rebuild with `--clear`, then revert `.env`. An inline `EXPO_PUBLIC_API_URL=...` does NOT win over the `.env` file.
- **zsh does not word-split unquoted `$VAR`** → `perl ... $FILES` passes the whole newline-joined list as ONE filename ("Can't open …: No such file"). Use `find … -exec perl -pi -e '…' {} +` for codemods.
- **Web styling missing locally** → `app/static/css/tailwind.css` is committed empty (0 bytes) and built by `npm run build:css` (CI/deploy). Rebuild after editing tokens in `tailwind.web.config.js` / `base.html`.

## Chronological log (newest first)

### 2026-06-07 · Mobile app could not bundle (NativeWind preset missing)
- Symptom: `expo start` → Metro config load fails: "Tailwind CSS has not been configured with the NativeWind preset".
- Cause: `mobile/tailwind.config.js` lacked `presets: [require("nativewind/preset")]` (pre-existing; babel/metro/global.css were all correct).
- Fix: added the preset line → app bundles (1464 modules) and renders on iOS Simulator.
- Lesson: NativeWind v4 needs the preset in the Tailwind config specifically; jest + tsc are blind to it — verify with a real render.
