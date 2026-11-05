# Claim-proof board — hackathon build notes

This page (`/research/claims`) tests a financial claim against retained SEC filing rows. It is the Meta Global AI Developer Hackathon build of BenchmarkWatcher: Muse Spark selects a bounded research plan and evidence; application code calculates every number.

## What is new here vs. the existing product

- Baseline product revision: `dd870e2` (SEC research, deterministic calculators, citation checks).
- New in this branch: `app/claim_proof/` (engine, filing loader, audit, bounded model contract, routes), fourteen fixtures in `data/filing-proof/`, `app/templates/claim_proof.html`, the claim-proof JS/React components and CSS, and the test suites listed below. The baseline had no claim board, no cohort investigation and no model-selected evidence.

## Run it

Requires Python 3.14 and Node 22 for the JS tests.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python - <<'PY'
from app import create_app
app = create_app()
app.run(host='127.0.0.1', port=5059)
PY
```

Open `http://127.0.0.1:5059/research/claims`. The page works without any model credential; the "Ask Meta" segment needs an OpenAI-compatible Muse Spark endpoint (see below). Data is fixed and checked in — no SEC client, downloader or fallback runs at this boundary.

### Model segment

The hackathon demo runs `meta-models/muse-spark-open-1026` on Baseten. The adapter is not in this repository; the product contract it implements is `app/claim_proof/meta.py` (`status()` / `cohort()`), with one request per investigation, 45s deadline, zero retries, one in-flight call, an allowlisted JSON selection and a lifetime spend ceiling. Without an adapter the page reports `not_activated` and makes no request.

## Tests

```bash
pytest tests/test_claim_proof.py tests/test_claim_meta.py -q          # 190 passed
NODE_PATH=$PWD/node_modules node --test tests/claim-*.test.cjs tests/investigation-brief.test.cjs  # 84 passed
```

## Verified demo figures (USD millions, Microsoft FY2024 → FY2025)

| Input | FY2024 | FY2025 | Basis |
| --- | --- | --- | --- |
| Revenue | 245,122 | 281,724 | Reported |
| Operating income | 109,433 | 128,528 | Reported |
| Operating cash flow | 118,548 | 136,162 | Reported |
| Cash PP&E additions | 44,477 | 64,551 | Reported outflow magnitude |
| Calculated FCF | 74,071 | 71,611 | OCF − cash PP&E |

Revenue +14.93%; operating margin 44.64% → 45.62% (+0.98pp); calculated FCF −3.32%. MSFT/AAPL/GOOGL shortfalls versus revenue growth: 18.25, 15.65, 14.40 percentage points. A −25% cash PP&E scenario flips MSFT to +18.47% FCF growth; it is labelled arithmetic, not a forecast.

Evidence: Microsoft FY2024/FY2025 annual reports and SEC 10-K accessions `0000950170-24-087843`, `0000950170-25-100235`. Every fixture row carries the accession, filing date, source URL and a SHA-256 of the retained company-facts payload; the recheck recomputes the selection against those snapshots.

## Limitations

- Fourteen companies, two annual periods (each issuer's own FY2024/FY2025), two claims: FCF growth and operating-income growth versus revenue growth.
- Comparisons are within-company only; fiscal calendars differ and are never presented as matching calendar intervals.
- Calculated FCF is operating cash flow minus gross cash PP&E purchases. Issuer-defined FCF may differ (Amazon, Meta and Tesla notes are on the cards).
- Consolidated rows cannot identify AI-only spending; the product declines that question instead of allocating PP&E.
- Scenarios are algebra on retained figures, not forecasts or causal claims. No trading recommendations.
- The model selects evidence and plan only; it never writes a number, formula or verdict.
