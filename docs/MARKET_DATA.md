# Stock and currency histories

This opt-in feature serves saved daily observations from a dedicated small
SQLite cache. Public pages never call a provider, including on an empty or stale
cache. Marketstack and exchangerate.host ingestion runs on the operator's Mac
through Varlock, with separate durable provider budgets kept locally. The server
receives only a validated observation snapshot; it has no vendor credentials and
its existing daily fetch job does not run these collectors.

## Included coverage and request plan

| Provider | Prepared coverage | Expected scheduled units |
| --- | --- | --- |
| Marketstack `weekly-15` (default) | 15 US stocks; each refresh fetches daily bars | 60–75 in a typical month |
| Marketstack `daily-3` | Apple, Microsoft and NVIDIA after weekday closes | At most 69 for 23 weekday closes |
| exchangerate.host | 20 USD-based currency pairs, including MNT; previous UTC day's historical snapshot | At most 31 per month |

Marketstack charges each ticker lookup separately, even in a batched HTTP
request. The first stock fetch requests up to one year in one page per ticker;
later fetches overlap recent history. No automatic pagination, retry, discovery,
or extra historical backfill is performed. FX requests include all configured
pairs in one response. Quote identity, currency, dates, pagination, finite values,
and completeness are validated before an atomic cache update.

For verified provider-period enrollment, the application limit is at most 90
units per provider billing period, leaving 10 of the stated 100-request allowance
outside routine ingestion. A separate initial application grant permits a single
bounded launch when billing dates remain unknown; its validity window is never
represented as a provider billing period. Failed or
uncertain attempts remain charged locally. Other consumers of these account
allowances must be included in the enrollment baseline and coordinated; a local
counter cannot see calls made by unrelated tools or guarantee a provider invoice.

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
A feature flag or application counter does not establish these facts. There is
no automatic upgrade, paid fallback, subscription change, or remote activation in
this change.

Official references, checked 2026-10-23:

- https://marketstack.com/pricing
- https://marketstack.com/faq
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
| `MARKETSTACK_PROFILE` | `weekly-15` or `daily-3` | `weekly-15` |
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

### One-time initial application grant

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
an initial grant, **all subsequent enrollment is refused**, including another
grant or a regular verified billing period, even after expiry. Reconciliation
into future provider periods is not implemented. Preserve the private ledger;
removing or replacing it is not a renewal procedure. Private ledgers use schema
version 2; incompatible older ledgers fail closed without automatic migration.
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

Snapshots are capped at 8 MiB, 35 instruments and 1,100 observations per
instrument. Older observations may be omitted only for a full-capacity rolling
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
