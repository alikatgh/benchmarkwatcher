# Global public-source coverage

The broader indexed WDI, FAOSTAT and SEC library is documented in
[Public data library](PUBLIC_DATA_LIBRARY.md). This page describes the earlier
bounded reference readers and their verified October 3 coverage. The `/sources`
page reads current saved library coverage separately from publisher metadata.

BenchmarkWatcher has five bounded official readers, 31 catalogued publishers,
and **1,248 downloaded World Bank country histories across 217 economies**,
plus eight other global references and seven Canadian commodity indices.
The source directory and saved references show these separately from the
1,498 discovered WDI indicator definitions. A provider, an API endpoint, an indicator, and a country
series are different things and must not be counted interchangeably.

## What is implemented

| Source | Configured observations | Access | Classification |
| --- | --- | --- | --- |
| Bank of Canada | Seven monthly commodity indices and daily USD/CAD reference | No account, key, or access charge | Official commodity indices; indicative FX |
| European Central Bank | Daily EUR references for USD, GBP, JPY | Public no-key access | Indicative exchange references |
| Eurostat | German and French total HICP annual change, monthly frequency | Free no-key statistics API | Consumer inflation, percent |
| World Bank | Six reviewed indicators across 217 economies; 1,248 nonempty histories, 31,088 observations | Public no-key bulk Indicators API | Annual population, constant-price GDP, GDP per capita, consumer inflation, agriculture and industry shares |
| Malaysia Ministry of Finance | RON97 petrol and diesel for Sabah, Sarawak and Labuan | Published no-key CSV | Administered retail fuel prices in MYR/litre |

The Malaysian CSV includes both `level` and `change_weekly` rows for each date.
Only explicit `series_type=level` rows are used for these retail-price series;
weekly changes never overwrite levels, regardless of CSV row order.

The first seven Bank of Canada series are stored with commodity **indices** in
`data/`. The original fourteen reference series and the country expansion are stored
separately in `data/global-reference/`: FX, population, national-accounts/inflation
statistics, and Malaysian
administered fuel prices. Retail fuel must retain its country, product, and
administered-price label; it must not replace crude oil or wholesale fuel
references. Definitions use the existing `index` category for compatibility;
`reference_type` is the authoritative distinction and the storage partition.
The six previously published agriculture IDs remain available and share the
bulk update; they are not counted twice.

The definitions are in [`scripts/global_series.json`](../scripts/global_series.json).
Each preserves source URL, country/coverage, currency, units, frequency,
reference type, and attribution. `price` is a compatibility field in the
existing record schema. A statistic expressed in percent is still a statistic,
and an FX reference is still an exchange reference.

## Downloaded country coverage

The reviewed bulk configuration is [`worldbank_bulk_series.json`](../scripts/worldbank_bulk_series.json).
Each selected indicator's official page explicitly identifies CC BY-4.0 reuse.
One complete request per indicator retrieves 2000–2025 observations for all
returned economies. Known region/income aggregates are excluded using official
country catalog identities, including income aggregates with an empty ISO3
code. All-empty country histories are not saved or counted.

| Indicator | Economies with observations | Saved observations | Unit |
| --- | ---: | ---: | --- |
| [Population](https://data.worldbank.org/indicator/SP.POP.TOTL) | 217 | 5,642 | People |
| [GDP](https://data.worldbank.org/indicator/NY.GDP.MKTP.KD) | 213 | 5,345 | Constant 2015 US$ |
| [GDP per capita](https://data.worldbank.org/indicator/NY.GDP.PCAP.KD) | 213 | 5,345 | Constant 2015 US$ per person |
| [Consumer inflation](https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG) | 193 | 4,684 | Annual % |
| [Agriculture, forestry and fishing share](https://data.worldbank.org/indicator/NV.AGR.TOTL.ZS) | 205 | 5,023 | % of GDP |
| [Industry including construction share](https://data.worldbank.org/indicator/NV.IND.TOTL.ZS) | 207 | 5,049 | % of GDP |

The 3 October 2026 batch made exactly six unauthenticated requests and saved
1,248 nonempty country/indicator histories. Missing years, source flags,
footnotes and provider decimal metadata remain distinct; values are not rounded
or filled. Historical estimates remain estimates. Constant-price GDP must not
be described as current-dollar GDP.

`worldbank_manifest.json` indexes only successfully saved histories. Web pages
read this bounded cached index, paginate 30 rows, and support country, measure,
type and text filtering. `/reference/<id>` reads one cached file for its D3
chart and exact observations. `/sources` links available economies/indicators
to their loaded histories and labels other catalog entries as unconnected.
Public requests never contact upstream services or open every history file.
Five readers still means five readers; 1,248 country histories is not a claim
of 1,248 distinct publishers or APIs.

## Source discovery is separate from observations

The registry in [`scripts/source_registry.json`](../scripts/source_registry.json)
contains 31 official sources across Europe, North America, South America,
Asia, Oceania, Africa, the Middle East, and worldwide institutions.
Each entry records documentation, access and billing state, reuse conditions,
quotas where verified, review date, and readiness:

- `adapter_ready`: an implemented no-key reader; production activation is a
  separate step.
- `catalogued`: documentation recorded, with no reader enabled.
- `needs_registration`: an account/key/token is required; none was acquired.
- `access_review`: access, licensing, or endpoint restrictions remain unresolved.

Live discovery on **3 October 2026** returned:

| Provider catalog | Observed metadata | What this does not mean |
| --- | --- | --- |
| World Bank WDI | 1,498 indicators; 217 economies; region/income aggregates separated | Every indicator is populated for every economy, licensed identically, or connected |
| Bank of Canada Valet | 15,948 series definitions | 15,948 fetched observation histories or commodity series |
| IMF DataMapper | Current official documentation advertises v2; its catalog request failed during the audit | A working current integration; legacy v1 responses are not silently substituted |

Discovery reads catalogs in a few requests rather than issuing a request for
every possible economy/indicator combination. Newly discovered metadata stays
`catalogued` until a useful series, units, history, reuse rights, and data quality
are reviewed. No thousand-source scheduler is created.

The public [catalog snapshot](../scripts/global_catalog_snapshot.json) contains
all 1,498 discovered WDI indicators and 217 economies, plus 134 selected Canadian
reference definitions. The full Canadian catalog count is recorded; unrelated
series metadata is not copied into the repository. Snapshot metadata is not
automatically scheduled for observation downloads.

## Run without changing production data

All commands require the project's Python dependencies. The default audit and
listing commands perform **no network requests**:

```sh
.venv/bin/python scripts/source_audit.py
.venv/bin/python scripts/fetch_global_sources.py --list
```

Discover public metadata into an explicit report location:

```sh
.venv/bin/python scripts/source_audit.py \
  --discover worldbank bank_canada \
  --output /tmp/benchmarkwatcher-source-catalog.json
```

Probe one real series per reader without writing observation files:

```sh
.venv/bin/python scripts/source_audit.py \
  --probe ca_bcpi_bcpi ecb_eur_usd de_hicp_annual_change \
    in_wb_agriculture_share my_ron97 \
  --output /tmp/benchmarkwatcher-source-probes.json
```

Fetch explicitly selected records into a separate staging folder:

```sh
.venv/bin/python scripts/fetch_global_sources.py \
  --series ca_bcpi_bcpi ecb_eur_usd de_hicp_annual_change \
  --output-dir /tmp/benchmarkwatcher-reference-staging
```

Fetch all six reviewed indicators into an explicit staging folder:

```sh
.venv/bin/python scripts/fetch_global_sources.py \
  --worldbank-bulk --max-requests 6 \
  --output-dir /tmp/benchmarkwatcher-country-reference-staging
```

Fetch operations do not modify `scripts/commodities.json` or production `data/`
by default. Failed/no-data responses leave an existing output record intact.
The operator can inspect staged records before enabling them in the normal
daily job.

## Deterministic staged import

A downloaded country batch can be imported without making any network requests:

```sh
.venv/bin/python scripts/seed_global_reference.py \
  --staging-dir /tmp/benchmarkwatcher-country-reference-staging \
  --destination-dir data/global-reference --dry-run

.venv/bin/python scripts/seed_global_reference.py \
  --staging-dir /tmp/benchmarkwatcher-country-reference-staging \
  --destination-dir data/global-reference
```

The importer validates every staged identity, reviewed definition, unit, source
year, fetch timestamp, latest observation and manifest count before mutation.
It preserves all existing observations outside the incoming window, destination
custom metadata, and original revision entries, including existing duplicate
annotations. Operator notes on individual observations survive refreshes while
source flags, footnotes and decimal metadata are replaced authoritatively.
The six previously published agriculture paths are merged after checking their
published semantic identity and units. Other
existing destinations require matching reviewed definitions and nonconflicting
observations; identical partial imports are resumable. Newer destination source
values, flags, footnotes and precision metadata cannot be replaced by older
evidence. Newer destination fetch and update timestamps are retained.

Each record is saved atomically. The reconstructed index is saved last and uses
the actual merged histories, so retained older observations contribute to its
counts. Previously indexed histories absent from staging remain indexed. A
write failure leaves the previous index in place and the importer can be resumed.
Run imports while the normal daily fetch job is not writing the same directory.
Staged input is retained. Neither validation nor import calls a provider or
creates a paid connection.

A complete 1,248-history test import preserved six agriculture archives and
custom annotations plus an additional 1990 observation. Dry run made no file
changes; the imported index correctly counted 31,089 observations, and a repeated
import safely resumed all 1,242 new country paths without duplicating revisions.

## Daily integration

The compatibility reader
`scripts.fetchers.global_reference.fetch_global_reference(provider, **parameters)`
is registered as `GLOBAL_REFERENCE` in `scripts/fetchers/__init__.py`.
`scripts/fetch_daily_data.py` appends only enabled `commodity_index` definitions
to its commodity configuration. It updates the other enabled definitions in a
separate reference batch and directory. Six bulk World Bank requests replace
the six previous individual-country requests, expanding coverage within the
same budget. All global series share one
`OfficialClient(max_requests=20)` per run, including host pacing, request limits
and repeated-URL caching. The single-series compatibility fallback creates and
closes its own one-request client.

The daily record builder retains `currency`, `frequency`, `kind`,
`reference_type`, `countries`, `date_semantics`, `attribution`, `source_id`,
and the source URL. It retains observations older than the latest downloaded
window, including source period labels and statistical flags. When a source
revises an observation's value or flag, the replacement is current and the
superseded observation is appended to `revisions` (including flag, footnote
and decimal-metadata changes); repeated unchanged responses
do not create duplicate revisions. Failed/no-data or unreadable-archive updates
leave the saved reference file intact. Currency conversion or index rebasing
must remain separately identified calculations.

The app should partition these records by `reference_type` before rendering
commodity-only views. Source details should name the publisher, country,
measure, unit, period, and last successful fetch. For annual/monthly statistics,
display the original `period` rather than presenting a fabricated daily quote.
Compare percent-valued statistics in percentage points where appropriate; a
relative percent change is a different calculation and must be labelled.

## Bounds and costs

- GET-only fixed allowlist of official HTTPS hosts and paths; redirects rejected.
- Connect/read timeouts of 5/25 seconds; 4 MiB streamed body cap.
- At most 30 requests per command, normally 12 for audits and 20 for ingestion.
- Explicit individual selection (at most 25 configured series), or the six reviewed
  bulk indicators. A bulk response must be complete, source 2, at most 10,000 rows
  and 4 MiB; incomplete pages fail closed. Historical windows cover at most 30
  years and older saved observations remain in the archive.
- At least one second between requests to the same host; repeated identical
  responses cached for the command. Provider quotas take precedence.
- No automatic retries, keys, accounts, checkout, subscriptions, or payment setup.
- Missing/non-finite values remain gaps. No interpolation or zero substitution.
- Source values retain their precision; descriptive calculations are separate.
- Original monthly/annual period labels are retained. Their plotting dates are
  period starts, **not release dates**. Daily/weekly series retain source dates.
- Current/future World Bank annual periods are excluded from this historical
  reader. This does not turn estimates in historical years into audited actuals.

Public access has no API charge for the five enabled readers. Hosting, storage,
bandwidth, and optional AI remain separate costs; a free API is not unlimited
infrastructure. In particular, **UN Comtrade has both a limited free plan and
paid products**, while some national APIs require registration or have overseas
access restrictions. The catalog never automatically upgrades or buys access.

## Official evidence and material restrictions

| Provider/region | Access and reuse evidence | Restrictions to retain |
| --- | --- | --- |
| Canada | [Valet access](https://www.bankofcanada.ca/valet-api-how-to/), [terms](https://www.bankofcanada.ca/terms/), [commodity-index methodology](https://www.bankofcanada.ca/rates/price-indexes/bcpi/) | Attribution, accuracy, third-party rights; indicative FX; caching |
| ECB | [API](https://data.ecb.europa.eu/help/api/data), [statistics reuse](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html) | Quote source; preserve original observations and metadata; identify derivatives |
| Eurostat | [Free API](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction), [reuse exceptions](https://ec.europa.eu/eurostat/help/copyright-notice), [2026 HICP change](https://ec.europa.eu/eurostat/web/hicp/information-data) | Commercial exceptions for some non-European/trade data; new ECOICOP 2 schema |
| World Bank | [No-key API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392), [terms](https://data.worldbank.org/summary-terms-of-use) | Generally CC BY 4.0; individual third-party indicator rights can differ |
| Malaysia | [Fuel dataset and licence](https://data.gov.my/data-catalogue/fuelprice), [API quota](https://developer.data.gov.my/rate-limit) | CC BY 4.0; API four requests/minute; product and regional distinctions |
| OECD | [API](https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html), [quotas](https://www.oecd.org/en/data/insights/data-explainers/2024/11/Api-best-practices-and-recommendations.html) | 60 downloads/hour; no anonymized/VPN traffic; large-query restrictions |
| FAO | [2026 developer portal](https://www.fao.org/statistics/highlights-archive/highlights-detail/faostat-launches-a-new-api-developer-portal-to-make-data-access-easier/en), [database terms](https://www.fao.org/contact-us/terms/db-terms-of-use/en) | Attribution, no endorsement/promotion, dataset-specific third-party conditions |
| UN Comtrade | [Free and paid plans](https://comtradeplus.un.org/Subscriptions) | Free registration/key; 500 calls/day, one/second; premium excluded |
| UK | [ONS developer documentation](https://developer.ons.gov.uk/) | No key; beta and dataset/OGL terms need review |
| Australia | [ABS API](https://www.abs.gov.au/statistics/application-programming-interfaces-apis/data-api-user-guide) | Keys removed in 2024; beta API may lag website; dataset licences need review |
| Japan | [e-Stat guide](https://www.e-stat.go.jp/api/en/api-info/api-guide), [terms](https://www.e-stat.go.jp/api/en/terms-of-use) | Account/application ID, credit, no sharing IDs |
| Korea | [KOSIS API](https://kosis.kr/openapi/devGuide/devGuide_0101List.do), [2026 overseas-access response](https://kosis.kr/eng/bulletinBoard/qnaView.do?boardIdx=340093) | Key/identity requirements; overseas-access limitation remains |
| India | [Official portal](https://www.data.gov.in/), [government licence](https://www.data.gov.in/sites/default/files/Gazette_Notification_OGDL.pdf) | API-enabled resources/key needed; licence attribution and exclusions |
| Brazil | [BCB open catalog](https://dadosabertos.bcb.gov.br/) | Selected SGS licence/range limits require review; live probe failed here |
| Mexico | [Banco de México SIE](https://www.banxico.org.mx/SieAPIRest/service/v1/) | Token, quotas, and reuse rules need verification before enabling |
| Chile | [BDE API support](https://si3.bcentral.cl/estadisticas/Principal1/Web_Services/ayuda_soporte_en.html) | Free registered account/token; credit and identify transformations |
| Indonesia | [BPS access policy](https://ppid.bps.go.id/app/konten/0000/Layanan-BPS.html) | Free registered aggregate-data API; other statistical products can be paid |
| Israel | [CBS API](https://www.cbs.gov.il/en/cbsNewBrand/Pages/API-interface.aspx) | Mandatory User-Agent; selected-data reuse needs review |
| UAE | [National summary data](https://fcsc.gov.ae/national-summary-data/) | Public SDMX links exist; internal/test endpoints excluded; licences unverified |
| Africa | [AfDB endpoint diagnostics](https://datamanager.afdb.org/ws/nsi_ws), [South Africa table/API export](https://superweb.statssa.gov.za/webapi/online-help/Download-Tables---SuperWEB2.html) | External endpoint/portal access and licence not yet verified; World Bank supplies separate cross-country coverage |

None of these policy notes substitutes for checking an individual dataset's
current conditions when enabling it. The catalog records uncertainties instead
of treating every public website as an unrestricted free API.

## Verification

`tests/test_global_sources.py` checks readiness/billing separation, hostile URL
rejection, streamed body bounds, request budgets and caching, units/series
identity, missing periods, precision, statistical flags, source-catalog
pagination, aggregate separation, the current Eurostat schema, complete bulk-page checks, country/aggregate identities,
nonempty coverage counts, source notes, previous-ID preservation, and preservation
of saved data after failures. Fuel fixtures distinguish level/change rows in
both orders. Tests use fixtures/mocks and make no API calls.

On 3 October 2026 all five implemented readers returned real observations in
explicit live probes. ECB timed out once; a manual single-request recheck
succeeded. Probe evidence is an observation of availability at that time, not
a service-level or future-completeness guarantee.

The initial staging ingestion also fetched all **21 configured series**. Its
first 20-request batch succeeded for 19; a separate manual two-request recheck
resolved the ECB JPY and Japan World Bank timeouts. Japan and UAE's selected
annual statistic has its latest usable observation in 2024, rather than a fabricated
2025 value. These records were staged separately, then seeded exclusively into
21 new local paths: seven commodity indices and fourteen global references.
Existing files were not replaced. Release/deployment is a separate step.


The country expansion was fetched in a separate six-request batch: all six
indicators succeeded. Every manifest entry was checked against its saved file,
identifier, original years, units, latest value, observation count and attribution.
Rendered checks cover a paginated thousand-history index and country-to-D3
journeys at phone and desktop widths. Deployment is a separate state.
