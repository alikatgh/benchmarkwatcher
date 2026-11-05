#!/usr/bin/env bash
# Mirror claim-proof feature files from this product checkout to the isolated
# demo worktree. Product is the single source of truth; the demo tree never
# flows back. Fails closed on any missing file or unchecked destination.
set -euo pipefail
DEMO="${BENCHMARKWATCHER_DEMO:-/Users/s_avelova/Documents/Codex/2026-10-26/we-a/benchmarkwatcher-integration}"
FILES=(
  app/claim_proof/__init__.py
  app/claim_proof/audit.py
  app/claim_proof/engine.py
  app/claim_proof/filings.py
  app/claim_proof/meta.py
  app/claim_proof/routes.py
  app/templates/claim_proof.html
  app/static/css/claim-proof.css
  app/static/js/components/claim-proof.js
  app/static/js/components/claim-ranking.react.js
  data/filing-proof/aapl.json
  data/filing-proof/amzn.json
  data/filing-proof/googl.json
  data/filing-proof/meta.json
  data/filing-proof/msft.json
  data/filing-proof/tsla.json
  data/filing-proof/nflx.json
  data/filing-proof/amd.json
  data/filing-proof/now.json
  data/filing-proof/pltr.json
  data/filing-proof/amgn.json
  data/filing-proof/hon.json
  data/filing-proof/unp.json
  data/filing-proof/bkng.json
  tests/claim-growth-gap.test.cjs
  tests/claim-proof-format.test.cjs
  tests/claim-research.test.cjs
  tests/claim-saved-recheck.test.cjs
  tests/claim-selected-evidence.test.cjs
  tests/investigation-brief.test.cjs
)
if [[ ! -d "$DEMO/app" ]]; then
  echo "Demo destination missing: $DEMO (set BENCHMARKWATCHER_DEMO to override)" >&2
  exit 2
fi
for relative in "${FILES[@]}"; do
  if [[ ! -f "$relative" ]]; then
    echo "Source file missing: $relative" >&2
    exit 2
  fi
  if [[ ! -f "$DEMO/$relative" ]]; then
    echo "Demo file missing (never create scope implicitly): $relative" >&2
    exit 2
  fi
  cp "$relative" "$DEMO/$relative"
done
echo "Synced ${#FILES[@]} claim files to $DEMO"
