# Stock and currency histories

This opt-in feature serves saved daily observations from a dedicated small
SQLite cache. Public pages never call a provider, including on an empty or stale
cache. Marketstack and exchangerate.host ingestion runs on the operator's Mac
through Varlock, with separate durable provider budgets kept locally. The server
receives only a validated observation snapshot; it has no vendor credentials and
its existing daily fetch job does not run these collectors.

## Coverage and request accounting

| Provider/profile | Coverage strategy | Quota accounting |
| --- | --- | --- |
| Marketstack `monthly-100` | Reviewed catalogue of 100 US stocks; new/oldest histories first; 32-day refresh cadence | One unit per requested ticker, regardless of HTTP batching |
| Marketstack `weekly-15` (legacy default) | Original 15 companies, 7-day cadence | 15 units per complete refresh |
| Marketstack `daily-3` | Original three companies after weekday closes | Three units per complete refresh |
| exchangerate.host | Every available USD quote returned for the previous UTC date, up to 200; no currency selection filter | One HTTP request for all quotes on that date |

The symbol catalogue is checked using Marketstack's public downloadable CSV and
SEC's public company/exchange metadata, without authenticated discovery calls.
Stock responses already contain identity/currency metadata. By default the first
fetch asks for a year; later fetches request accumulated new days with a small
overlap. The explicit `refresh_due(..., history_days=7)` operator option instead
requests only the most recent seven calendar days. `history_days` accepts integer
values from 1 through 365 and defaults to 365. It changes the requested window,
while preserving every previously saved observation. Stocks with the same
exchange and date range share an HTTP call.
Batch size is bounded by `floor(1000 / inclusive_calendar_days)`, conservatively
keeping the combined response inside the 1,000-row limit even before accounting
for weekends. A batch of two stock symbols still consumes two quota units.

For initial breadth, a seven-day window can collect 100 new symbols across two
exchanges in two HTTP requests while still charging 100 ticker units. The actual
validated observation dates and counts define each displayed history; a recent
window is not a full-year history. Combining a short window with a 32-day cadence
can leave intervening dates absent, and no gap is filled with an inferred price.
The default year-long window remains available when historical depth is wanted.

On 2026-10-24, retained responses for some newly requested stocks contained
inconsistent historical currency metadata despite matching symbol/exchange
fields. A shorter explicit request window can avoid those older dates without
discarding rows inside a response. Every returned row in the requested window
must still validate; changing the window does not authorize retrying a charged
failure or relabeling a foreign-currency observation as USD.

The current Marketstack V2 schemas require `symbols` even on exchange-wide EOD
routes. Their broad introductory descriptions do not establish an all-company,
one-credit endpoint. No quota exemption is assumed. Automatic pagination and
retries are disabled. Dates, pagination completeness, each requested identity,
currency and finite values must validate. An invalid ticker's complete history
is rejected; other valid requested tickers in that batch may be saved. Foreign
symbols/exchanges or a truncated batch reject the entire response.

FX uses one response for all returned quotes. The source, exact historical date,
timestamp, three-letter quote identifiers and positive finite values are checked.
A USD/USD self-quote must equal one and is omitted. Metals and other provider
codes retain their precise labels; they are not relabeled as fiat currencies.
No cross-rates or missing observations are fabricated.

Each provider has a durable, independently enforced **100-unit maximum over any
rolling 32-day window** after explicit authorization. This is deliberately
conservative: a window of 32 days covers a monthly period of at most 31 days,
without guessing the vendor's reset date. It is an application safeguard in
addition to the verified account's free/no-overage controls. Historical rows
inside a response do not each consume a ticker unit. Fetching a full year once
and serving the cache is therefore more economical than repeated latest-only
lookups.

All previous reservations remain charged, including failed/uncertain attempts.
Any original external-usage baseline is retained conservatively indefinitely.
Other use of these accounts must be coordinated; a local counter cannot observe
unrelated clients or establish a provider invoice ceiling. Do not reset the
ledger or infer unused credits from a stale dashboard.

## Activation prerequisites

The features are implemented but disabled by default. The published Free plans
for both vendors specify **non-commercial use**. An open-source application is
not automatically non-commercial, and API access is not blanket permission to
republish vendor data as a downloadable dataset. Confirm the intended display
and retention rights before enabling public access. Vendor snapshots are kept
separate from the public-library export and must not be uploaded to Hugging Face
without specific redistribution rights.

Verify the actual account's free allowance, remaining usage, and provider-enforced
absence of billable overages before activation. Regular period enrollment also
requires verified billing-period boundaries. An initial application grant can be
used without those boundaries, under the nonrenewable restrictions below.
Rolling-window authorization needs no invented billing dates; it does require the
verified account controls and current durable usage. A feature flag or application
counter does not establish these facts. There is
no automatic upgrade, paid fallback, subscription change, or remote activation in
this change.

Official references, checked 2026-10-24:

- https://marketstack.com/pricing
- https://marketstack.com/faq
- https://marketstack.com/download/supported_tickers_2.csv
- https://www.sec.gov/files/company_tickers_exchange.json
- https://marketstack.com/billing-overages-documentation
- https://docs.apilayer.com/marketstack/docs/marketstack-api-v2-v-2-0-0
- https://exchangerate.host/pricing
- https://docs.apilayer.com/exchangerate/docs/exchangerate-host-api-v-1-0-0

## Private operator configuration

Use the operator-configured Varlock integration to supply the two credential
variables to the local collector process. Do not put credentials in a command
line, commit, document, browser, chat, or test fixture. The standalone market
refresh CLI reads only its process environment and does not inspect private files
itself. Keep encrypted values and their decryption material on the Mac. Never
copy either to the server or pass them to a transfer command.

| Variable | Purpose | Default |
| --- | --- | --- |
| `MARKETSTACK_API_KEY` | Marketstack credential | Unset |
| `EXCHANGERATE_HOST_API_KEY` | exchangerate.host credential | Unset |
| `MARKETSTACK_ENABLED` | Permit bounded background stock requests when `1` | Disabled |
| `EXCHANGERATE_HOST_ENABLED` | Permit bounded background currency requests when `1` | Disabled |
| `MARKETSTACK_PROFILE` | `monthly-100`, `weekly-15` or `daily-3` | `weekly-15` |
| `MARKET_DATA_ENABLED` | Expose cached stock/FX pages when `1` | Disabled |
| `MARKET_DATA_DB` | Local collector ledger, or the server's separate observation snapshot | `data/vendor-market-data.sqlite3` |

Adding credentials alone activates nothing. The cache and budgets are created
only by explicit enrollment. For regular provider-period enrollment, supply the
verified current billing period and already-used account units; do not infer them
from the calendar or the plan name. The following placeholders must be replaced
with verified values:

```sh
.venv/bin/python scripts/refresh_market_data.py \
  --enroll-provider marketstack \
  --period-start '<verified UTC start>' \
  --period-end '<verified UTC end>' \
  --limit 90 --already-used <verified used units>
```

Enroll `exchangerate_host` separately. Overlapping or repeated periods cannot
reset counters. An expired provider-period budget stops further requests until
the next verified period is enrolled; it does not silently reset on a calendar
date or restart. This renewal route is unavailable to any provider that has ever
received an initial application grant.

### Explicit rolling-window authorization

After account verification, an operator can convert an existing enrolled ledger
using `authorize_rolling_budget(path, provider, valid_from, expires_at,
expected_used=current_used)`. The function makes no network request. Its validity
window must include the current UTC time and last no more than 32 days. It rejects
active jobs and a changed usage count. Authorization must be explicitly renewed;
expiry stops new requests and never erases past reservations.

The first conversion transaction adds `rolling_authorizations` and upgrades the
private ledger from schema 2 to 3. Existing periods, jobs, locks, reservations and
cached observations remain intact; failed conversion rolls back. Old schema-2
reads retain their original restrictions until explicit authorization. The old
stock-recovery marker cannot be replayed. Once rolling authorization is active,
normal budgeted jobs can proceed under the new aggregate cap.

`reserve_batch` atomically reserves one unit for every requested stock symbol
before transport. Insufficient remaining quota or a duplicate call key rejects
the whole reservation batch. Successful and failed members keep their own
reservations and outcomes. Public pages cannot invoke authorization or fetching.
The collector's optional `coverage_limit` bounds a single run; later chunks resume
only untouched members, with durable date/profile keys preventing duplicate calls.

Use the `monthly-100` profile to prioritize breadth. Previously spent credits may
leave fewer than 100 histories available on the first run, and invalid provider
responses remain excluded. The feature does not promise that a catalogue entry
has saved observations. The UI lists actual validated cached histories only.

### Legacy one-time initial application grant

When the account allowance, usage baseline and absence of billable overages are
verified but exact billing dates are unknown, an operator may explicitly enroll
one application grant per previously unenrolled provider. Supply the application's
current UTC validity start and an expiry no more than 24 hours later. These dates
are application controls, not inferred billing/reset dates. The limit includes the
observed already-used account units and cannot exceed 90. For a zero-usage first
fetch, use limits of **15 for Marketstack** and **1 for exchangerate.host**:

```sh
.venv/bin/python scripts/refresh_market_data.py \
  --enroll-initial-provider marketstack \
  --application-valid-from '<application UTC start>' \
  --application-expires-at '<application UTC expiry within 24 hours>' \
  --limit 15 --already-used 0

.venv/bin/python scripts/refresh_market_data.py \
  --enroll-initial-provider exchangerate_host \
  --application-valid-from '<application UTC start>' \
  --application-expires-at '<application UTC expiry within 24 hours>' \
  --limit 1 --already-used 0
```

Both commands enroll only; neither constructs a provider transport or fetches
data. Application date options cannot be combined with `--period-start` or
`--period-end`. The default `weekly-15` stock profile can then use at most 15
stock units, and FX at most one unit. Reservations remain charged after failures,
process termination and restart. Expiry never resets the counter. Status reports
`application_grant` or `application_grant_expired`, with `grant_valid_from` and
`grant_expires_at`, retaining usage after expiry.

An initial grant requires no prior enrollment of any kind. Once a provider has
an initial grant, subsequent legacy enrollment is refused, including another
grant or a regular provider period. The explicit rolling-window conversion above
is the supported continuation; it preserves all prior charges. Preserve the private ledger;
removing or replacing it is not a renewal procedure. Private ledgers use schema
2 before explicit rolling conversion and schema 3 afterward. Incompatible older
ledgers fail closed without automatic migration.
Public observation snapshots retain their version-1 format and contain no grant
provenance or quota information.

### One bounded stock recovery

A separate operator-only recovery function can authorize one repair after the
specific first-fetch outcome of 15 charged Marketstack units: one successful
cached stock and 14 distinct one-unit failures recorded as `invalid_response` or
`identity_mismatch`. It requires an active initial application grant with limit
15, zero enrollment baseline, an expected-current-usage comparison of 15, no
active job and no prior recovery authorization. It does not apply to FX or to a
regular provider-period enrollment.

`begin_initial_stock_recovery(path, expected_used=15)` atomically raises the same
grant's cumulative limit from 15 to 29 and creates the sole recovery job and
provider lease. All original charges, validity dates and baseline remain intact.
It returns a token and the eligible original reservation IDs, subjects and
required deterministic call keys. No new ledger, enrollment, refund or billing
period is created. There is no automatic recovery, retry or recovery CLI.

Only this job can reserve the additional units, one per original failed ticker;
the original successful ticker and arbitrary calls are refused. A failed or
uncertain repair stays charged and cannot be tried again under another call key.
Ordinary refresh jobs are blocked after recovery authorization. The existing
600-second lease and original grant expiry remain enforced; after lease loss,
finish or grant expiry, unconsumed recovery units cannot be activated by creating
another job or repeating authorization. Any retained response for offline
validation must use its existing charged reservation and the still-active job;
offline parsing does not authorize another provider call. Recovery state remains
private and is excluded from observation snapshots.

After enrollment and the prerequisite checks, an operator can enable the intended
providers and run the standalone CLI locally through Varlock. The local collector
uses its durable ledger across runs. Server refreshes install only the sanitized
snapshot; the ledger is never uploaded. An awake, online laptop is required for
new observations. No automatic local schedule is installed by this change. Status
is read-only:

```sh
.venv/bin/python scripts/refresh_market_data.py --status
```

To stop new requests, disable the relevant provider flag. Saved data remains
available while `MARKET_DATA_ENABLED=1`. To hide the new public pages too, disable
that separate flag. Do not remove the cache/ledger to reset usage.

## Observation-only transfer

The local collector database contains both observations and quota accounting.
Never upload that database. `scripts/market_data_snapshot.py` exports a newly
built SQLite file containing only the `instruments` and `observations` tables.
It imports no collector, resolves no credentials and makes no network requests.
Run it as a separate command after the Varlock-wrapped collector has exited:

```sh
.venv/bin/python scripts/market_data_snapshot.py export \
  data/vendor-market-data.sqlite3 '<new snapshot path>'
```

Export refuses an existing output path and reports the snapshot SHA-256. Transfer
only that file through the existing authenticated deployment connection. On the
server, use its verified application interpreter and runtime user:

```sh
python scripts/market_data_snapshot.py check '<staged snapshot>' --sha256 '<exported hash>'
python scripts/market_data_snapshot.py install '<staged snapshot>' \
  '<dedicated server market cache>' --sha256 '<exported hash>'
```

Installation requires the transport hash, checks the exact public schema and
bounded typed rows, then rebuilds a clean snapshot using the server's SQLite
version. The installed hash can differ from the exported hash across SQLite
versions. The installer uses a lock, staged files, fsync and atomic replacement;
it retains one validated `.previous` recovery snapshot. It refuses collector
ledgers, unrelated databases, stale/partial histories, database symlinks, and
observed destination/recovery/lock changes during installation. Install only in a
trusted application-owned directory: POSIX replacement is not an absolute
compare-and-swap guarantee against a malicious writer with the same permissions.

Snapshots are capped at 32 MiB, 100 stocks plus 200 FX instruments, and 1,100
observations per instrument. Cadence metadata is bounded to 1–32 days. Older observations may be omitted only for a full-capacity rolling
history. Source extraction is capped at 64 MiB; operations check a 15-second
work deadline. Repeated identical snapshots are no-ops. A failed refresh or
transfer leaves the last installed history available with its original dates.

Vendor histories support on-page charts and exact observation tables. Their
Quick visual/export integration is disabled until redistribution rights are
established; ordinary public-reference exports retain their existing behavior.
This controls the supplied export features, not arbitrary browser copying.

## Verification

Tests use synthetic fixtures and mocked providers. They cover concurrent first
enrollment and final-unit reservations, nonrenewable initial grants, the 24-hour
validity cap, 15-stock/1-FX cumulative exhaustion, CLI date-mode isolation, old-ledger
rejection, one-time recovery authorization races, exact failed-ticker scoping,
recovery lease/grant expiry, verified period enrollment/expiry, restart and timeout accounting,
lease fencing, duplicate suppression, data validation, retention, credential
redaction, disabled behavior, and network-free repeated page browsing. Existing
reference and public-library routes remain separate. Browser checks use a local
synthetic preview; they do not establish provider acceptance or production access.


## No-key reference integrations

Frankfurter and OpenFIGI use `scripts/refresh_open_market_data.py` and a separate
`data/open-market-data.sqlite3` cache. They never touch the paid providers' quota
ledger or load credentials. Public routes remain read-only and make no upstream
requests. Set `OPEN_MARKET_DATA_ENABLED=1` and `OPEN_MARKET_DATA_DB` to the validated
cache path, alongside `MARKET_DATA_ENABLED=1`, to display the additional data.
Both new settings are disabled/unset by default. Missing optional data preserves
existing market pages; a corrupt optional cache is reported without hiding the
healthy paid-provider histories.

Frankfurter requests the ECB provider explicitly. Initial collection requests
its complete available EUR-base daily history in yearly chunks; later runs merge
a seven-day overlap with new dates. All source observations are preserved. Each
currency retains its actual first/last observation; an old endpoint is not proof
of retirement. No rates from other central banks are blended in, and no missing
days, inverse rates or cross-rates are invented. Source coverage, retrieval range
and refresh time remain distinct in the UI.

OpenFIGI maps at most 100 saved, reviewed US stock listings, ten jobs per HTTP
request. Ticker, US composite exchange code, USD and Equity constrain each mapping.
Only a unique US composite common-stock result is accepted. Documented no-match
warnings are reported and skipped; malformed or ambiguous results fail the run.
The catalogue MIC remains separate from provider identity metadata: the API does
not verify a specific listing venue. Composite and share-class FIGIs remain
distinct. These are security identifiers,
not an additional stock-price feed or evidence of historical ticker ownership.

An explicit run is bounded to 40 HTTP requests, 600 seconds, 20 seconds per
request, 4 MiB per response, 64 MiB of database pages and 512,000 observations.
Requests are durably reserved and spaced by at least ten seconds for Frankfurter
and three seconds for OpenFIGI. There are no automatic retries. Complete results
publish atomically; incomplete initial histories remain staged and can resume.
Successful refreshes have 24-hour ECB and 30-day OpenFIGI cooldowns; failed runs
wait at least five minutes or the larger upstream Retry-After. Existing complete
data remains available after a failed refresh. No new scheduler is installed.

```sh
.venv/bin/python -m scripts.refresh_open_market_data --status
.venv/bin/python -m scripts.refresh_open_market_data --provider all --max-requests 40
```

The collector needs outbound HTTPS only for an explicitly requested refresh.
`--status`, imports, lists, details and search do not contact either provider.
Keep the collector cache separate from any public dataset export. Deployment
copies only the reviewed no-key cache after checking its exact schema, bounds,
complete published histories and empty staging/lock state; it must never replace
the paid-provider ledger or snapshot.

Reuse and attribution, checked 2026-10-24:

- ECB permits accurate reuse with attribution: https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html
- Frankfurter is a delivery service; upstream data terms still apply: https://frankfurter.dev/license/
- OpenFIGI describes the identifiers and associated metadata as MIT-licensed:
  https://www.openfigi.com/ and https://www.openfigi.com/docs/faqs
- FIGI identifiers also carry the public-domain dedication and no-endorsement
  terms at https://www.openfigi.com/docs/terms-of-service
- API batching and no-key limits: https://www.openfigi.com/api/documentation

Source pages retain ECB/Frankfurter and OpenFIGI attribution. Neither provider's
logo or name implies sponsorship. The optional integrations add no paid plan,
API credential, advertising agreement or automatic background job.
