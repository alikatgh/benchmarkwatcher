# Known UI Debt

_Phase 1 audit · 2026-06-07. Severity = visual-quality impact (no P0 broken-UI found). Each item notes the **cascade fix** (shared-layer change) where one edit covers many screens — per CLAUDE.md §4c, prefer these over per-file edits._

## P1 — Serious (quality / consistency)

### UI-1 · Brand split between web and mobile
Mobile renders in stock Tailwind `slate/blue/emerald/rose`; web uses the FT brand (claret/teal/oxford on paper, Georgia serif). They read as two different products.
- Where: `mobile/tailwind.config.js` (`extend:{}` empty) · `HomeScreen.tsx`, `CommodityDetailScreen.tsx`, `CompactCommodityRow.tsx` (slate/blue throughout).
- **Cascade fix:** add brand tokens + serif display to `mobile/tailwind.config.js`; swap `slate/blue/emerald/rose` → brand tokens. Market up/down already comes from `getMarketColors()`.

### UI-2 · Weight hierarchy has collapsed
**247 `font-bold` + 9 `font-extrabold`** across web templates (mobile similar). When nearly everything is bold, nothing leads the eye.
- **Cascade fix:** adopt a 3-role type convention — *display* (serif, bold), *value* (semibold, tabular-nums), *label* (medium, uppercase, muted). Set sane element defaults in `base.html`; reduce blanket `font-bold` on labels via a codemod.

### UI-3 · Redundant / clunky microcopy on the compact row
`CompactCommodityRow` renders the literal string **"▲ Direction Up"** right next to the already-colored, signed `%` change — saying the same thing three ways (arrow + word + colored number).
- Where: `mobile/components/CompactCommodityRow.tsx:93-98`.
- **Fix:** drop the "Direction {label}" text; the colored signed % already encodes direction. (Removes copy → vocab-safe.)

## P2 — Quality

### UI-4 · Micro-text overload
**129 sub-12px labels** (41×`text-[9px]`, 82×`text-[10px]`, 6×`text-[11px]`). Hard to scan; reads as busy.
- **Cascade fix:** collapse to two label sizes via tokens (`--text-2xs`, `--text-xs`) with one tracking value; codemod the arbitrary `text-[Npx]` to the tokens.

### UI-5 · Shadows vs. flat/hairline aesthetic
**18 shadow instances** (8 inline `box-shadow` + 10 `shadow-*`) plus the `--card-shadow` token. Cards float instead of sitting on hairlines.
- **Cascade fix:** set `--card-shadow: none` (or remove), drop inline `box-shadow`, lean on `--theme-border`. One token change flattens every card.

### UI-6 · Corner-radius sprawl
**9 distinct radii** in use: `rounded-lg`×118, `xl`×57, `md`×13, `full`×11, `sm`×6, `2xl`×5, `r`×1, `none`×1.
- **Cascade fix:** standardize to 3 steps — chips/controls 8px, cards 12px, pills `full`. Codemod the outliers (`md/2xl/sm`).

### UI-7 · Hover changes geometry (price card)
Grid card hover fires **5 effects at once**: `-translate-y-1` lift + gradient fade-in + border color + arrow translate + title color.
- Where: `app/templates/components/price_card.html:13-16,70`.
- **Fix:** keep border-tint (and maybe arrow) only; remove `-translate-y` and gradient. (UI rule: interactive state must not move/resize geometry.)

### UI-8 · Busy nested tiles in Market Pulse
Card-in-card: a `card-warm` panel holds four `bg-black/5` tinted sub-tiles, each bordered.
- Where: `app/templates/index.html:39-72`.
- **Fix:** flatten to hairline-separated rows; drop the inner fills.

### UI-9 · Mobile active states are off-brand
Active category = solid **black** pill (`bg-slate-900`); active range = **blue** chip (`bg-blue-100`).
- Where: `HomeScreen.tsx:226,280`.
- **Fix:** brand bg-tint + brand text, matching the web `[data-active]` convention (bg-tint + brand secondary text, no geometry change).

### UI-10 · `!important` theme-override sprawl
~150 lines of per-utility `!important` overrides hardcode the `bloomberg`/`ft` themes instead of driving them from tokens.
- Where: `app/templates/base.html:342-448`.
- **Fix (enables clean cascade):** express those themes through `--theme-*` / `--color-*` tokens like the other 5 themes; delete the `!important` blocks.

## P3 — Polish

- **UI-11 · Dashed borders** on empty/preview states (`border-dashed`×2) read as "unfinished." → solid hairline. (`index.html`, `grid_view.html`)
- **UI-12 · Double loading affordance** on mobile detail: a blue "Fetching…" banner *and* a skeleton. → pick one. (`CommodityDetailScreen.tsx:302-314,398`)
- **UI-13 · Unicode `▲▼` arrows** vary in glyph weight vs. the SVG icon set. → a single shared arrow/icon.
- **UI-14 · Spacing rhythm** mixes `p-3/4/5/6` and ad-hoc `py/px`. → one 4/8/12/16/24 scale.

## Risks (not UI debt — verify separately)

- **R-1 · `tailwind.css` committed at 0 bytes**, relying on CI `build:css`. If any deploy path skips that step, the site ships unstyled. Confirm the deploy runs `npm run build:css`.

---

## Phase 2 — RESOLVED (2026-06-07)

Cascade-first redesign applied; verified green (vocab / web-jest / pytest / mobile-jest / mobile-tsc) and visually confirmed on web (light + dark + mobile width).

| Item | Status |
|---|---|
| UI-1 Brand split | ✅ Fixed — mobile `tailwind.config.js` re-tones slate/blue/indigo to the FT brand; hardcoded chart/spinner hexes remapped to claret/teal/oxford |
| UI-2 Weight collapse | ✅ Fixed — `font-extrabold`→`bold`; micro-label `font-bold`→`semibold` (codemod across templates **and** the JS render layer) |
| UI-3 Direction microcopy | ✅ Fixed — `CompactCommodityRow` shows the arrow only, colored by the market color |
| UI-4 Micro-text | ◑ Partial — `text-[9px]` tier removed (→10px); full tokenization deferred |
| UI-5 Shadows | ✅ Fixed — `--card-shadow: none` (all themes), `shadow-sm` removed, header inline shadow removed |
| UI-6 Radius sprawl | ✅ Fixed (web) — `rounded-2xl`→`xl`, `rounded-md`→`lg` |
| UI-7 Hover geometry | ✅ Fixed — `-translate-y` card lift removed |
| UI-9 Mobile active states | ✅ Fixed — now brand-toned via the config cascade |
| UI-11 Dashed borders | ✅ Fixed — solid hairline |
| UI-8 Busy nested tiles | ◑ Largely mooted by the flattening; no structural rework |
| UI-10 `!important` theme sprawl | ⬜ Deferred (maintainability, not visual) |
| UI-12 / UI-13 / UI-14 | ⬜ Deferred P3 polish |

**Web:** screenshotted — clean, editorial, on-brand in light + dark. **Mobile:** verified by typecheck + tests + the deterministic config cascade; not screenshotted (no Expo simulator in this environment).
