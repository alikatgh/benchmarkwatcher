# Session State

**Goal:** Level up ALL UI (web + mobile) while keeping the FT-editorial concept. Sequential phases 1→3, then verify+land.

**Phases**
1. ✅ Audit all UI → `docs/SCREEN_INVENTORY.md`, `docs/UI_SYSTEM.md`, `docs/KNOWN_UI_DEBT.md`
2. ✅ Cascade redesign (faithful-polish) — DONE: flattened shadows (`--card-shadow:none`), tamed weight (extrabold→bold, label bold→semibold), standardized radii, removed hover-lift + dashed borders (web codemod on templates **and** JS); mobile `tailwind.config.js` re-tones slate/blue/indigo to brand + chart hex remap. Verified green + screenshotted (web light/dark/mobile-width). Mobile not screenshotted (no simulator).
3. ✅ Ralph loop — hero screens (dashboard + commodity detail) pass the faithful-polish rubric at 1280 + 375, light + dark. No P0/P1 found; declared done after 1 verification iteration (no manufactured churn). Deferred P3 nuances: dark-mode chart keeps oxford vs teal; minor active-button treatment variance.
4. ✅ Landed — branch `redesign/faithful-polish-ui`, commit `cbcd5af` (92 files). Gate green. `main` untouched at `ce9ac5d`. Not pushed.
5. ✅ Mobile verified on **iOS Simulator** (real render, live data): brand cascade confirmed — warm paper, serif headings, teal-up/claret-down, oxford accents, real commodity cards. Fixed a pre-existing build blocker: `mobile/tailwind.config.js` was missing the NativeWind v4 preset (app couldn't bundle at all) — see `docs/BUG_JOURNAL.md`. Two pre-existing issues observed (out of scope): prod `/api/commodities` returns 500; mobile change values render raw floats (e.g. `+0.09699999999999998`).

**Test gate:** GREEN — `check:vocab` ✓, `jest` ✓, `pytest` 68 passed ✓, mobile ✓.
⚠️ Run pytest with **`venv/bin/python -m pytest tests`** — the Homebrew `python3` (3.14) has no pytest and reports a false failure.

**Working tree:** ~2k-line uncommitted UI diff sitting directly on `main` (verified green). Should land on a feature branch in Phase 4.

**Audit headline:** No P0s. Biggest levers — unify mobile onto web brand tokens (UI-1), tame the 247 blanket `font-bold` (UI-2), flatten shadows (UI-5). Full list in `docs/KNOWN_UI_DEBT.md`.
