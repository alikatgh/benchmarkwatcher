# Screenshot Rubric

Binary pass/fail checks applied to every screenshot in a `/ralph-redesign` loop.
Derived from `~/.claude/UI_DESIGN_RULES.md` (the floor) + `docs/UI_SYSTEM.md`
(FT-editorial brand). Every check is answerable YES/NO from the screenshot
(or a single grep where noted). P0 fail → stop the loop and report. P1 fail →
fix before the next iteration. P2 → fix if touching that area anyway.

## P0 — broken / credibility-destroying

- [ ] Page renders: no blank canvas, no unstyled-HTML flash, no JS error reported by the shoot harness.
- [ ] No horizontal overflow at 375px (no clipped cards, no sideways scroll).
- [ ] Every price/percent legible: no `NaN`, `undefined`, `--` placeholders, or 4-decimal noise.
- [ ] Dark theme: text ≥ readable contrast on its surface (no dark-on-dark or light-on-light block).
- [ ] Up/down semantics correct: positive = teal, negative = claret (western mode default).

## P1 — serious (design-rule violations)

- [ ] **No card shadows.** Stationary cards/tiles/rows separate by hairline border + bg step, never `box-shadow`. (Popover/modal/toast exempt.) Grep check: no `shadow-` / inline `box-shadow` on cards.
- [ ] **State never changes geometry.** Hover/active/checked does not translate, scale, resize, or change border-width. Grep check: no `hover:*translate*`, `hover:scale`, active-state padding/border-width deltas.
- [ ] **No colored side rails** on list rows, nav items, or cards (`border-left` accents / edge strips).
- [ ] **Hierarchy = weight + size, not color.** ≤1 brand-color accent per region; headings not brand-colored unless CTA; screenshot still reads in greyscale.
- [ ] **Surface steps present in both themes**: canvas < card < overlay each a perceptible tonal step (dark theme needs ≥ ~6% lightness gap).
- [ ] **Tabular numbers** on all prices/percents/deltas (columns of digits align vertically).
- [ ] **Type roles hold**: display = serif bold; values = semibold tabular; labels = medium uppercase muted. Labels are not blanket-bold. (Debt UI-2.)
- [ ] **≤2 label sizes below 14px**, none below the `--text-2xs` token. No ad-hoc `text-[9px]`-style arbitrary sizes. (Debt UI-4.)
- [ ] **Radius scale is 3-step**: controls/chips 8px, cards 12px, pills full; nested radii concentric (outer = inner + padding). (Debt UI-6.)
- [ ] **Brand parity**: screen uses claret/teal/oxford/paper tokens — no stock Tailwind slate/blue/emerald/rose. (Debt UI-1, mobile especially.)
- [ ] **No decorative icons** next to labels that already say it; no redundant direction words beside a signed colored %. (Debt UI-3.)

## P2 — polish

- [ ] One accent per card: badge OR colored value, not both saying the same thing twice.
- [ ] 40×40px minimum hit area on interactive controls at 375px.
- [ ] Headings `text-wrap: balance`; no orphan single-word wrap in card titles at 375px.
- [ ] Empty/loading states styled (skeleton or `.empty-state`), not raw text.
- [ ] Consistent spacing rhythm: card padding uniform across grid; no tile visually denser than its siblings. (Debt UI-8.)

## How to shoot

Web: `node scripts/shoot_ralph.mjs <path> <name>` → 375px + 1280px, light + dark, into `artifacts/shots/ralph/`. Mobile: Expo web at 375px viewport, light + dark via settings.
