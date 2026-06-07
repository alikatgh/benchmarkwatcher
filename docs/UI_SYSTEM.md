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
1. **`mobile/tailwind.config.js`** — currently `theme: { extend: {} }` → **EMPTY**, so the app renders with stock Tailwind `slate/blue/emerald/rose`. **This is the primary lever:** add brand tokens (paper / ink / ink-muted / claret / teal / oxford / surfaces) + a serif display font here, then swap utility classes.
2. **`mobile/context/SettingsContext.tsx`** — `getMarketColors(isUp)` already themes up/down text + chart colors (good, reusable). Neutrals/surfaces are NOT themed (hardcoded slate).
3. **`mobile/global.css`** — NativeWind entry.

## The biggest single "level up"
Web ships the full FT brand; mobile ships **stock Tailwind**. They look like two different products. Unifying mobile onto the web's brand tokens (claret/teal/oxford + paper + serif display) is the highest-leverage change in the whole effort — and it's a cascade edit (config + token swap), not a per-screen rewrite.
