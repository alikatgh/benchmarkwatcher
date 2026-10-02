# API usage and cost visibility

Signed-in users can open **Profile** at `/workspace/profile` for current-month
and all-recorded usage. Records are private to the account and responses are
not cached. No credentials, prompts, answers or filing text enter the usage log.

## What is counted

- Each DeepSeek and TypeSafe HTTP attempt is reserved before network access.
  Connection tests, extra explanations and failed calls are included. Provider
  usage is captured before answer validation, so a rejected answer is still counted.
- SEC network downloads made for an authenticated user are recorded at zero
  SEC cost. Reads from the shared filing cache make no new outbound request.
- Opening saved reports, D3 charts and deterministic calculations make no AI call.
- Earlier saved answers contribute available token counts once. Their cost remains
  unavailable; older failures, deleted answers and connection tests cannot be recovered.

## Estimates, not invoices

Rates were checked on **October 2, 2026** against the providers' official pages:

- [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/): Flash aliases
  use peak USD rates of 0.006 / 0.30 / 1.20 per million cached input / uncached
  input / output tokens. V4 Pro uses 0.044 / 1.32 / 3.96. Off-peak is half-price.
  Peak windows are weekdays 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese
  public holidays. The app gives a range in those windows because it does not
  determine holiday eligibility. Missing cache splits also produce a range.
- [TypeSafe](https://docs.typesafe.ai/models): Jev 1.13.0 and its current aliases
  use USD 0.042 per million input tokens. Output is uncharged.
- [SEC EDGAR](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
  public access and downloads are free.

Costs use integer nanodollars and are stored with the rate-card date. Unknown
models, absent usage and failed/unfinished requests remain unpriced, never zero.
The summary explicitly counts unpriced requests excluded from the subtotal.
Provider credits, taxes, custom plans, future rate changes and usage in other apps
are not included. The provider's billing record is authoritative. Update the rate
card after checking official pricing when adding models or when prices change;
earlier records are never repriced automatically.

## Controls and limits

The default maximum is **30 outbound paid AI calls per account per rolling 24
hours**, including failed attempts. Users can lower their limit or pause new
paid requests in Profile. An atomic SQLite reservation enforces it across workers.
The Flask configuration `WORKSPACE_DAILY_API_REQUESTS` can set the ceiling from
1 to 60. This is separate from the existing analysis and endpoint rate limits.

The app makes no automatic paid retries or automatic balance top-ups. AI requests
use only the account owner's encrypted key. DeepSeek output is limited to 1,200
tokens; serialized provider payloads are limited to 96 KiB. No provider call is
sent if its usage reservation cannot be saved. An interrupted request remains
visible with unknown outcome and still consumes its reservation.

A request limit is not a dollar cap. Use a provider spending cap or bounded
prepaid balance for account-wide protection. Hosting, domain renewals and
separately purchased services are outside this ledger.

## Verification

`python -m pytest tests/test_api_usage.py tests/test_workspace.py tests/test_company_workspace.py`

These tests use synthetic responses, exercise limits concurrently, and do not
spend provider credits. Database setup adds usage tables without changing or
removing saved keys, reports or analyses. Back up the private SQLite database
before deploying an application update that changes its schema.
