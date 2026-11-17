# PRODUCT.md (draft from shipped artifact — Impeccable init interview still open)

## What this is
BenchmarkWatcher: historical benchmark/reference data plus SEC-filing
claim-proof research. Not trading, not real-time, not advice.

## Who it serves
Analysts, founders, and financially curious readers who see a claim
("growth kept pace") and need the periods, definition, source rows, and
assumptions behind an answer.

## Surfaces
- Homepage library (commodities, countries, companies) with market pulse.
- Market workspaces (stocks, exchange rates) with detail charts.
- Claim proof (`/research/claims`): test falsifiable claims, rank
  shortfalls, save/recheck/export investigations.
- Company research workspace with portable backups.

## Visual system (from shipped code)
- Tokens: `--theme-accent` (blue), `--theme-text/-muted`, `--theme-border`,
  `--theme-surface`; tabular numerals for all figures; 12–16px card radii;
  2px accent focus rings; accent `::selection`.
- Dark and light themes; mobile-first stacking with controls before results.
- One motion: ranked-list rise on recalculation, reduced-motion respected.
- Language guard: no forecast/predict/signal/return vocabulary in UI copy.

## Non-negotiables
- Every number traces to a retained source row or it doesn't ship.
- Rounded display never decides verdicts; exact backend arithmetic does.
- Imported/saved content is labelled unverified until rechecked.
- Snapshots are labelled historical; freshness is stated, not implied.
