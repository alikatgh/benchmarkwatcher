# UI System & Cascade Levers

_The shared layers to edit in Phase 2 so one change restyles every screen at once (CLAUDE.md §4c: cascade before per-file editing — one token beats N per-file edits)._

## Concept (KEEP — do not change the idea)
Financial-Times-style editorial commodity-benchmark **reference** (not advice). Georgia serif for display, Inter for UI. Brand: **claret `#990f3d`**, **teal `#0d7680`**, **oxford `#0f5499`** on warm paper `#fffcfa`. Calm, data-first, tabular.

## Web cascade layers (edit these, then rebuild CSS)
1. **`tailwind.web.config.js`** — Tailwind theme tokens compiled into the stylesheet: `brand-claret/teal/oxford`, `brand-black-80/60`, `brand-pink/paper/slate`, `terminal-black/surface`, `card-warm`. Color / spacing / radius / font scales live here.
2. **`app/templates/base.html` `<style>` (lines ~36–739)** — the runtime design system:
   - **Tokens (CSS vars):** `--theme-bg/surface/text/text-muted/border/accent`, `--color-up/down(+-bg/-border)`, fluid type `--text-2xs…--text-3xl` (clamp-based), `--card-min-w`, `--card-shadow`.
   - **7 themes** (`light`, `dark`, `mono-light`, `mono-dark`, `bloomberg`, `ft`) + **3 market modes** (`western`/`asian`/`monochrome`) via `html[data-theme]` / `html[data-market]`.
   - **Component classes:** `.bw-popup-{backdrop,surface,menu,menu-item}`, `.empty-state`, `.loading-spinner/-overlay`, `.skeleton`, attribute-based active states `.theme-btn/.market-btn/.view-btn[data-active]`.
   - **Global element defaults:** body font, link underline-on-hover, `:focus-visible` ring, responsive type, reduced-motion, high-contrast, print.
3. **Build:** `npm run build:css` → compiles `tailwind.input.css` → `app/static/css/tailwind.css`. The file is committed **empty (0 bytes)** and built in CI/deploy. **After editing tokens you must rebuild** to see changes locally.

## Mobile cascade layers
1. **`mobile/tailwind.config.js`** — populated (2026-07-08): brand tokens (paper/wheat/claret/teal/oxford/ink) + **re-toned stock ramps** — `slate` → warm FT neutrals, `blue`/`indigo` → oxford/teal, `emerald` → teal ramp, `rose` → claret ramp — so existing utility classes (and `getMarketColors`) render on-brand with zero per-file edits. Also `fontSize['2xs']` (10px), the micro-label token (twin of web `--text-2xs`); no arbitrary `text-[Npx]`.
2. **`mobile/context/SettingsContext.tsx`** — `getMarketColors(isUp)` themes up/down text + chart colors via emerald/rose classes, which the ramp remap lands on teal/claret.
3. **`mobile/global.css`** — NativeWind entry.

## The biggest single "level up"
✅ Done (2026-07-08 ralph wave): mobile now shares the FT brand via the config-level ramp remap + serif display titles; web/mobile read as one product. See `docs/KNOWN_UI_DEBT.md` UI-1/UI-9 resolutions.
