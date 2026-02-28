# Web ↔ Mobile Parity Implementation Plan

Date: 2026-02-28
Source audit: `WEB_PARITY_AUDIT.md`

## Goal
Reach near-1:1 parity for interaction behavior while preserving native mobile UX quality.

## Scope Rules
- Keep API contract unchanged (`/api/commodities`, `/api/commodity/:id`).
- No user login/account flows.
- No new backend services required.
- Prefer incremental changes with test coverage per phase.

## Priority Buckets

### P0 — Must match before parity sign-off

#### 1) Detail chart interaction parity
**Gap:** Web chart has richer crosshair/tooltip semantics; mobile differs.

**Implementation tasks**
- Align selected-point tooltip content/format with web (date, value, percent mode context).
- Ensure price↔percent mode updates selected-point semantics exactly.
- Standardize range slicing behavior labels/edge cases to match web logic.

**Likely files**
- `components/features/SVGLineChart.tsx`
- `components/features/CommodityChartSection.tsx`
- `screen/CommodityDetailScreen.tsx`

**Acceptance criteria**
- Same value/date shown for equivalent history sample on both platforms.
- Same behavior when switching range and view mode with active selection.
- No regressions in compare overlay rendering.

**Estimated effort:** 1.5–2.5 days

---

#### 2) Export semantics parity
**Gap:** Web emphasizes file-style export; mobile currently uses share + clipboard copy.

**Implementation tasks**
- Keep native share flow, but make control labels and user messaging parity-equivalent.
- Ensure CSV action clearly communicates output destination (clipboard) and success feedback.
- Align exported image framing (chart-only vs section) with agreed parity target.

**Likely files**
- `components/features/CommodityChartControls.tsx`
- `screen/CommodityDetailScreen.tsx`

**Acceptance criteria**
- Export controls map 1:1 conceptually to web actions.
- User receives explicit feedback for CSV/image actions.

**Estimated effort:** 0.5–1 day

---

### P1 — Important parity polish

#### 3) Compact view parity enhancement
**Gap:** Web compact table has richer trend/sparkline/tooltip interactions.

**Implementation tasks**
- Add compact-row trend context enhancements where touch-friendly (e.g., optional mini trend metadata).
- Mirror key compact data points from web table row (price/chg/pct/date semantics).
- Keep mobile-first interaction (tap-focused) rather than hover-dependent behavior.

**Likely files**
- `components/CompactCommodityRow.tsx`
- `components/features/HomeModals.tsx`
- `screen/HomeScreen.tsx`

**Acceptance criteria**
- Compact row contains equivalent decision-critical data as web compact row.
- No hidden hover-only information remains unmatched.

**Estimated effort:** 1–2 days

**Status:** Completed (2026-02-28, touch-first parity)

---

#### 4) Home state persistence parity
**Gap:** Web relies on URL/state persistence; mobile uses local component state.

**Implementation tasks**
- Persist selected category/range/sort/view in AsyncStorage.
- Restore these states on app relaunch.
- Preserve current defaults as fallback.

**Likely files**
- `screen/HomeScreen.tsx`
- `context/SettingsContext.tsx` (or a dedicated home-state storage utility)

**Acceptance criteria**
- App reopens with prior home filter/sort/view state.
- No regression to refresh/sync behavior.

**Estimated effort:** 0.5–1 day

**Status:** Completed (2026-02-28)

---

### P2 — Nice-to-have parity tightening

#### 5) Messaging/wording parity sweep
**Gap:** Minor text differences across labels/help text.

**Implementation tasks**
- Align key labels (range context wording, sort labels, chart mode labels).
- Align error/empty state copy to web terminology where appropriate.

**Likely files**
- `screen/HomeScreen.tsx`
- `screen/CommodityDetailScreen.tsx`
- `components/features/*`

**Acceptance criteria**
- Critical control labels map directly web↔mobile.

**Estimated effort:** 0.5 day

**Status:** Completed (2026-02-28)

---

## Test Plan per Phase

### Unit/UI tests (mobile)
- Update/add tests in:
  - `__tests__/CommodityCard.test.tsx`
  - `__tests__/CompactCommodityRow.test.tsx`
  - `__tests__/useCommodities.test.ts`
  - Add focused tests for chart controls/tooltip behavior if missing

### Validation commands
- `npm run typecheck`
- `npm run test:ci`

### Manual parity checks
- Compare same commodity, same range, same mode on web and mobile.
- Verify export actions produce expected output/feedback.
- Verify persisted home state survives full app restart.

## Suggested Execution Order
1. P0.1 Chart interaction parity
2. P0.2 Export semantics parity
3. P1.4 Home state persistence parity
4. P1.3 Compact view enhancement
5. P2.5 Copy/label alignment

## Definition of Done
- All P0 items complete and validated.
- At least one full parity walkthrough passes for Home + Detail flows.
- `typecheck` and `test:ci` pass.
- `WEB_PARITY_AUDIT.md` updated from "high parity" to "parity signed-off" (or explicit remaining deltas).
