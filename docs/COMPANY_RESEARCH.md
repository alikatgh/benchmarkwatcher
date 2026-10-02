# SEC company research

The authenticated `/workspace/` entry point searches companies by ticker, name,
exchange-qualified ticker, or SEC CIK. Similar tickers are suggestions requiring
the user's selection. Opening a company creates a private, immutable report
snapshot without an AI call. Previously saved analyses remain accessible.
Example workbooks inform application metric definitions; the normal product does
not enumerate, load, export, or display the example directory.

## Data and calculation boundaries

- The SEC company directory resolves identity; submissions identify filings;
  Company Facts supplies company-wide GAAP/IFRS values. The latest annual and
  quarterly Inline XBRL documents provide supported business revenue breakdowns.
- Keep up to ten annual periods and 24 quarters. Each number retains its unit,
  dates, concept, accession, filing date, and source link. Later filed values win
  for the same concept and period. Missing values are never filled with zero.
- Additive cash-flow quarters can be obtained by subtracting cumulative values
  with the same fiscal start. Both input sources remain visible. Reclassifications
  between different filings can affect comparability. EPS and weighted-average
  shares are not subtracted or blindly summed.
- Trailing-year flows require four consecutive quarters with contiguous dates.
  Margins use underlying totals; balance-sheet values remain period-end values.
  Free cash flow means operating cash flow less purchases of property, plant and
  equipment. A relative change requires a positive starting value.
- Banking and insurance use dedicated statement rows; industrial free-cash-flow
  and margin formulas are not applied to those sectors. Customer-contract fees
  are not treated as a financial institution's total revenue.
- Business categories on different axes overlap. A business row is not guaranteed
  to reconcile to consolidated revenue. Custom concepts, multi-dimensional facts,
  unsupported Inline XBRL transformations, acquisitions, changed fiscal years and
  company-specific definitions can leave gaps. Source review remains necessary.
- Currency follows supported source disclosures; no exchange-rate conversion is
  performed. The SEC does not cover every global ticker. Foreign filers may have
  annual-only data. This is not a market-price feed or a forecasting system.

Official references: [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
and [developer resources](https://www.sec.gov/about/developer-resources).

## Questions and privacy

Built-in questions select metrics and periods, then run deterministic arithmetic.
For example: `Compare revenue in 2024 and 2025`, `Show quarterly operating cash
flow`, or `Give me a financial overview`. Follow-ups can reuse the preceding
metric. Questions and answers are saved to the report and isolated by owner.

Connected Jev selects a validated metric and period plan. DeepSeek receives the
question, bounded public filing evidence, and any calculated result, and returns
separately labeled commentary. It must cite a source in the supplied source list.
Citation syntax is validated; this does not prove every interpretation is correct.
Provider use requires explicit consent for each send and uses the user's encrypted
key. Built-in reports and calculations do not require a provider key.

## Deployment and operations

The existing workspace secrets and database configuration remain required.
Schema additions are `company_reports` and `company_messages`; migrations are
additive. Back up the existing account database before release. Keep account
databases, caches, provider keys and example files outside public source control.

Optional configuration:

- `SEC_USER_AGENT`: identify the application and operator contact for SEC access.
- `SEC_CACHE_DB`: Flask configuration for the shared SEC cache; defaults to a
  separate `sec-cache.sqlite3` beside the workspace database.
- `WORKBOOK_LIBRARY_ENABLED`: explicit Flask configuration for legacy fixture
  environments only; defaults to false, regardless of the model directory.

SEC downloads allow only SEC HTTPS hosts, reject redirects, limit response size
and duration, cache responses, and reserve at most four request slots per second
across workers sharing the cache. Directory cache: one day. Company JSON: one
hour. Immutable filing documents: seven days. Stale fallback is labeled in the
report. No browser-to-SEC requests are needed. Verify outbound SEC connectivity
from the actual application host before deployment. A rejected request produces
an explicit unavailable result; it never substitutes invented financials.

Report creation is limited to six requests per minute and 30 new snapshots per
account per day. Existing authenticated route limits, CSRF, provider daily limits,
and private response headers also apply. No background polling or provider calls
occur merely from opening a saved report.

## Verification

```sh
.venv/bin/python -m pytest tests/test_sec_financials.py tests/test_company_workspace.py -q
npm run test:companies
```

The company browser suite runs isolated synthetic SEC-shaped data through the
production parsing, calculation, persistence, chart and provider-consent paths.
It covers desktop and mobile, keyboard inspection, source details, CSV, saved
questions, light/dark contrast, unavailable companies and sector-specific rows.
Provider transport is simulated. No user accounts or real keys are used.

For an interactive synthetic preview:

```sh
PLAYWRIGHT_PORT=5784 .venv/bin/python -m tests.e2e.server --companies
```

Open `/workspace/register` on that local server. Search `AAPL` or `JPM`; their
reports contain clearly labeled invented company data. `MISS` exercises an
unavailable issuer. Fixture provider keys follow `docs/LOCAL_DEVELOPMENT.md`.
