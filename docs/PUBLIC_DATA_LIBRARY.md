# Public data library

`/data` browses country observations and `/companies` browses SEC reporting
companies. Search, charts, exact observations and CSV exports read a local SQLite
corpus; visiting a page never downloads from a publisher. `/sources` distinguishes
saved observations from catalog metadata. The existing benchmark files and
six-measure country view remain available.

## Local ingestion verified on 7 October 2026

| Saved dataset | Histories | Observations | Entities | Requested years |
| --- | ---: | ---: | ---: | --- |
| World Bank WDI | 243,741 | 4,385,363 | 217 economies | 2000–2025 |
| FAOSTAT production (QCL) | 57,756 | 1,314,190 | 204 economies/territories | 2000–2025 |
| FAOSTAT land use (RL) | 8,873 | 191,972 | 241 economies/territories | 2000–2025 |
| FAOSTAT agricultural trade (TCL) | 319,840 | 5,508,009 | 204 economies/territories | 2000–2025 |
| SEC selected disclosures | 69,968 | 413,852 | 12,363 companies | 2015–2025 |

These five committed local imports total **11,813,386 observations** across
**700,178 histories**. WDI includes 1,488 populated indicators; nine restricted
indicators are excluded. FAOSTAT trade includes 2,416 populated item/element
measures and currently ends in 2024. Its complete archive import took 28.7 minutes
on this Mac. Requested years do not imply every source has a value for every year.
This is local verification, not production deployment evidence. The previous
six-measure WDI reference view remains usable.

## Sources and meaning

- **World Bank WDI:** official bulk CSV, actual economies only, eligible indicators
  with their individual reuse terms. Restricted indicators are excluded. Footnotes,
  indicator/year notes, original decimal text, country metadata, archive digest and
  source vintage are retained. An indicator definition does not guarantee a value
  for every country or year.
- **FAOSTAT:** official normalized production (`QCL`), land-use (`RL`) and
  agricultural-trade (`TCL`) archives. Country/item/element/unit identities remain
  separate; regional and world aggregates are excluded. FAO area and UN M49 codes
  are not ISO codes. Original values, flags, flag definitions and source release
  dates are retained under the dataset's CC BY 4.0 attribution.
- **SEC:** eight selected US-GAAP measures in USD from annual calendar frames,
  covering assets, equity, cash, operating cash flow, net income and three distinct
  revenue concepts. Company identity is CIK. This is not a global listed-company
  census or a complete set of financial statements. Actual reporting start/end
  dates and filing accessions are retained. A calendar frame does not make every
  company's fiscal periods identical; revenue concepts are not substituted.

Missing values remain absent, zero remains zero, and current/future annual years
are not imported. Source estimates stay estimates. Numeric plotting uses floating
point; country-data tables and exports retain the publisher's original decimal
text. CSV exports include units, evidence, attribution, licence and source notes.

## Storage and imports

The corpus is `data/public-library.sqlite3`, separate from accounts, credentials,
private workbooks and the original commodity JSON files. Set `PUBLIC_LIBRARY_DB`
to an explicit absolute path when the web app uses a different corpus location.
Do not commit or publish local operational data or private repository history.

Run imports from the repository's Python environment. Choose a managed scratch
directory and sufficient free space before downloading. Dates below describe an
explicit historical bootstrap, not a claim that every source has every year.

```sh
python scripts/import_worldbank_library.py --database data/public-library.sqlite3 --scratch-dir "$LIBRARY_SCRATCH" --start-year 2000 --end-year 2025
python scripts/import_faostat_library.py --database data/public-library.sqlite3 --scratch-dir "$LIBRARY_SCRATCH" --dataset QCL --start-year 2000 --end-year 2025
python scripts/import_faostat_library.py --database data/public-library.sqlite3 --scratch-dir "$LIBRARY_SCRATCH" --dataset RL --start-year 2000 --end-year 2025
python scripts/import_faostat_library.py --database data/public-library.sqlite3 --scratch-dir "$LIBRARY_SCRATCH" --dataset TCL --start-year 2000 --end-year 2025 --max-seconds 7000
python scripts/import_sec_library.py --database data/public-library.sqlite3 --scratch-dir "$LIBRARY_SCRATCH" --start-year 2015 --end-year 2025
```

Configure `SEC_USER_AGENT` with the application's contact identity for operational
use. Each importer bounds downloads, rows, requests and/or runtime, streams ZIP
members without extracting them, and commits one complete dataset transaction.
Failure rolls back observations; missing source points do not erase saved history.
Changed points retain the superseded value and evidence. Older source vintages
cannot overwrite newer imports. Failed or rejected batches are not coverage.

WAL is the default journal mode. For a serial **offline** bootstrap only,
`PUBLIC_LIBRARY_JOURNAL_MODE=DELETE` avoids duplicating new pages in a WAL file;
readers can be blocked during large writes. Both modes preserve transaction
rollback. A 256 MiB reserve is checked before opening SQLite, periodically during
ingestion and before finalization. This is a last-resort guard, not a substitute
for estimating dataset and journal space beforehand.
The offline SQLite writer limits its page cache to 64 MiB; public readers keep
their normal smaller cache. Large initial imports should be serialized.

## Maintenance

The existing daily fetch job calls `scripts/refresh_public_library.py`. It refreshes
at most one overdue **already populated** dataset: SEC after seven days, WDI after
fourteen, FAOSTAT after thirty. There is no automatic bootstrap of new sources.
Scheduled SEC updates rotate through 98 core concepts over at most twelve
years, at most 400 calendar frames per run. A durable checkpoint advances only
after a committed batch; the catalog digest and requested years must match.
Previously saved older periods remain available. This does not imply that all
98 concepts have observations or that the initial expansion has been imported.
Attempts have a three-day cooldown. Eligible datasets are ordered by least recent
attempt, with overdue age as a tie-breaker, so a multi-dataset publisher outage
cannot starve the other sources. Refreshes defer when disk headroom is inadequate.
The outer job caps WDI at one hour and the much larger trade archive at two hours;
other datasets retain a thirty-minute cap. These are upper bounds, not refresh
duration guarantees. The service running the complete daily job needs a timeout
longer than the library subprocess limit; allow time for its other source tasks.
The storage guard requires the greater of 1 GiB or 1.3 times the SQLite file size
plus 512 MiB of free space. A populated collection can remain browsable while
refreshes defer because this reserve is unavailable.

```sh
python scripts/refresh_public_library.py --database data/public-library.sqlite3 --status
```

The status command is read-only. Web requests are read-only, paginated and subject
to a query-time budget; public browsing cannot launch an importer. Downloads and
licensing checks are operator tasks. Public availability, deployment and successful
scheduled execution must be verified separately from local ingestion.

Focused tests cover transactional preservation, source validation and identity,
precision, reuse metadata, revisions, refresh scheduling, bounded queries and
public search/detail/CSV journeys. See `tests/test_public_data_store.py`,
`tests/test_public_library_routes.py`, `tests/test_public_library_refresh.py` and
the three `test_*_library.py` importer suites.

## Wider catalog and full historical imports (8 October 2026)

The official FAOSTAT manifest contains 69 domains. Forty have explicit annual
country schema profiles. The remaining 29 retain concrete limitations, including
monthly periods, survey dimensions, bilateral trade identities, projections and
provider-specific reuse review. `scripts/faostat_catalog_snapshot.json` is a dated
inventory, not imported data. Browse `/sources` for the saved and pending states.

New FAOSTAT imports default to 1900 through the previous completed year, keeping
all available annual country observations within that window. The import record
stores the requested bounds, source vintage, archive size and skipped-row counts
in the same transaction as the data. Full historical coverage is shown only when
that proof matches the current catalog vintage. Legacy QCL, RL and TCL imports
still contain their original 2000–2025 requested window; they require backfill.
World Bank's default is now 1960; the existing saved WDI window is unchanged.
The IC credit archive has two exact element codes with blank CSV units. FAO's
official metadata defines these as index and ratio; the reader records that
resolution and preserves the original empty unit instead of guessing or
converting values.

The SEC reader catalogs 7,868 monetary, share-count and per-share concepts from
the official 2026 US-GAAP taxonomy, selecting 98 for its core plan. Its default
historical window begins in 2009. It supports bounded, resumable frame batches,
exact source decimals, canonical units and audited 404 frames. Custom issuer
concepts, other taxonomies and non-USD currency coverage are not included.
Catalog and plan output retain the FASB Authorized Uses notice; imported metadata,
pages and CSV exports carry it with copied official labels. See
`scripts/sec_concepts_NOTICE.html` and the provenance in `scripts/sec_concepts.json`.
Catalog size is not a count of available observations.

```sh
python scripts/import_faostat_library.py --catalog
python scripts/library_coverage.py --database data/public-library.sqlite3
python scripts/import_sec_library.py --plan --frame-limit 400
```

For a new dataset, a bounded staging database can be merged without copying the
whole saved corpus. Import into an empty staging path, validate it, then merge one
absent dataset at a time. The merger refuses existing dataset/series identities,
unknown populated tables, symlinks and incompatible schemas. It preserves exact
metadata, observations, revisions and import evidence in a single durable
transaction. Rollback, disk growth, a 512 MiB reserve and elapsed runtime are
checked; the target must already use DELETE journaling. This route cannot backfill
or refresh an existing dataset. Do not change journal modes during active reads.

```sh
python scripts/merge_public_library.py --staging "$STAGED_DATASET" --database data/public-library.sqlite3 --source faostat --dataset RP --max-growth-mb 256 --max-seconds 900 --plan
python scripts/merge_public_library.py --staging "$STAGED_DATASET" --database data/public-library.sqlite3 --source faostat --dataset RP --max-growth-mb 256 --max-seconds 900
```

Full existing-dataset refreshes still require the original conservative storage
reserve. Successful incremental additions do not mean that reserve is available.
The larger remaining archives and historical backfills stay pending when capacity
is insufficient; no catalog item or queued job is counted as saved coverage.
