#!/usr/bin/env python3
"""Import the official WDI bulk CSV archive into the public-data library.

ZIP members are streamed, never extracted. Only actual economies and finite
historical observations are imported. Existing JSON reference histories are not
modified. The shared LibraryWriter commits the entire import or rolls it back.

Source/format verified 2026-10-07:
https://datatopics.worldbank.org/world-development-indicators/
https://data.worldbank.org/summary-terms-of-use
The latter permits redistribution under CC BY 4.0 unless indicator metadata
specifies otherwise, and requires credit to the original data providers.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import zipfile
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path, PurePosixPath

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SOURCE = "worldbank"
DATASET = "WDI"
ARCHIVE_URL = "https://databankfiles.worldbank.org/public/ddpext_download/WDI_CSV.zip"
DATASET_URL = "https://databank.worldbank.org/source/world-development-indicators"
TERMS_URL = "https://data.worldbank.org/summary-terms-of-use"
IGO_LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/igo/"
CATALOG_PATH = Path(__file__).with_name("global_catalog_snapshot.json")
DEFAULT_DOWNLOAD_MB = 384
DEFAULT_EXPANDED_MB = 512
MAX_DATA_ROWS = 1_000_000
MAX_ANNOTATION_ROWS = 2_000_000
MAX_FIELD_BYTES = 2 * 1024 * 1024
MISSING_VALUES = {"", "..", "...", "-", "NA", "N/A", "NULL"}
_RESTRICTIVE_NOTES = re.compile(
    r"(?:not|cannot|may not) be (?:re-?distributed|reused)|"
    r"(?:redistribution|reuse) (?:is )?(?:prohibited|not permitted)|"
    r"(?:prior written|express) (?:consent|permission)|"
    r"(?:permission|consent) (?:is )?required|restricted[- ]use|"
    r"(?:non[- ]?commercial|personal) use only", re.IGNORECASE,
)


class WorldBankImportError(ValueError):
    """An upstream archive failed bounded validation; nothing was committed."""


def _year_bounds(start_year, end_year):
    end_year = date.today().year - 1 if end_year is None else end_year
    if (isinstance(start_year, bool) or isinstance(end_year, bool)
            or not isinstance(start_year, int) or not isinstance(end_year, int)
            or not 1900 <= start_year <= end_year < date.today().year):
        raise WorldBankImportError("Choose historical years from 1900 through the previous year")
    return start_year, end_year


def _byte_limit(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise WorldBankImportError(f"{label} must be a positive finite number")
    return int(value * 1024 * 1024)


def _archive_members(archive, *, max_expanded_mb):
    limit = _byte_limit(max_expanded_mb, "Expanded archive cap")
    infos = archive.infolist()
    if not 1 <= len(infos) <= 32:
        raise WorldBankImportError("WDI archive has an unexpected number of members")
    names, members, expanded = set(), {}, 0
    for info in infos:
        path = PurePosixPath(info.filename)
        mode = info.external_attr >> 16
        if (path.is_absolute() or ".." in path.parts or "\\" in info.filename
                or ":" in info.filename or "\x00" in info.filename
                or stat.S_ISLNK(mode) or info.flag_bits & 1):
            raise WorldBankImportError("WDI archive contains an unsafe or encrypted member")
        key = info.filename.casefold()
        if key in names:
            raise WorldBankImportError("WDI archive contains duplicate members")
        names.add(key)
        if info.is_dir():
            continue
        expanded += info.file_size
        if expanded > limit or info.file_size > limit:
            raise WorldBankImportError("WDI archive exceeds the expanded size cap")
        name = path.name.casefold()
        if name in members:
            raise WorldBankImportError("WDI archive contains ambiguous CSV member names")
        members[name] = info
    main = [members[name] for name in ("wdicsv.csv", "wdidata.csv") if name in members]
    if len(main) != 1 or any(name not in members for name in ("wdicountry.csv", "wdiseries.csv")):
        raise WorldBankImportError("WDI archive is missing its data, country or indicator metadata")
    members["data"] = main[0]
    return members, expanded


@contextmanager
def _csv_rows(archive, member, required, *, max_rows):
    """Validate CSV shape while reading through ZipExtFile's size/CRC checks."""
    old_limit = csv.field_size_limit()
    csv.field_size_limit(MAX_FIELD_BYTES)
    try:
        with archive.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as text:
            reader = csv.reader(text, strict=True)
            header = next(reader, None)
            if header is None:
                raise WorldBankImportError(f"{member.filename} is empty")
            header = [field.strip() for field in header]
            nonempty = [field for field in header if field]
            if len(nonempty) != len(set(nonempty)) or not set(required).issubset(header):
                raise WorldBankImportError(f"{member.filename} has invalid or missing CSV columns")

            def rows():
                count = 0
                for values in reader:
                    if not values or not any(value.strip() for value in values):
                        continue
                    count += 1
                    if count > max_rows:
                        raise WorldBankImportError(f"{member.filename} exceeds its row cap")
                    if len(values) != len(header):
                        raise WorldBankImportError(f"{member.filename} has a malformed row at line {reader.line_num}")
                    yield {key: value.strip() for key, value in zip(header, values) if key}

            yield header, rows()
    finally:
        csv.field_size_limit(old_limit)


def _country_catalog(path):
    if path is None:
        return None
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))["worldbank"]
        rows = payload["economies"]
        if not isinstance(rows, list) or not rows:
            raise ValueError("Missing economy catalog")
        result = {}
        for row in rows:
            code = row.get("id")
            if (not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9]{3}", code)
                    or not row.get("region") or row["region"].casefold() == "aggregates" or code in result):
                raise ValueError("Invalid actual-economy metadata")
            result[code] = row
        return result
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise WorldBankImportError("The local actual-economy catalog is invalid") from exc


def _countries(archive, member, catalog):
    result, excluded = {}, set()
    with _csv_rows(archive, member, ("Country Code", "Short Name", "Region"), max_rows=1000) as (_, rows):
        seen = set()
        for row in rows:
            code = row["Country Code"]
            if not re.fullmatch(r"[A-Z0-9]{3}", code) or code in seen:
                raise WorldBankImportError("WDI country metadata contains an invalid or duplicate code")
            seen.add(code)
            if (not row["Region"] or row["Region"].casefold() == "aggregates"
                    or (catalog is not None and code not in catalog)):
                excluded.add(code)
                continue
            if not row["Short Name"]:
                raise WorldBankImportError("WDI actual-economy metadata has an empty name")
            result[code] = row
    if not result:
        raise WorldBankImportError("WDI archive has no actual economies matching the catalog")
    return result, excluded


def _license(row):
    declared = row.get("License Type", "").strip()
    normalized = re.sub(r"[\s_-]+", "", declared).upper()
    approved = {"CCBY4.0": "CC BY-4.0", "CCBY4.0INTERNATIONAL": "CC BY-4.0",
                "CCBY3.0IGO": "CC BY 3.0 IGO"}
    if declared and normalized not in approved:
        return None, "unsupported license: " + declared
    notes = "\n".join(row.get(field, "") for field in (
        "Other notes", "Notes from original source", "General comments", "Limitations and exceptions"))
    if _RESTRICTIVE_NOTES.search(notes):
        return None, "indicator metadata specifies reuse restrictions"
    return approved.get(normalized, "CC BY-4.0"), None


def _indicator_unit(row):
    if row.get("Unit of measure"):
        return row["Unit of measure"], "WDI Unit of measure metadata"
    # Keep the source's wording. A title-derived unit is explicitly identified,
    # rather than silently treating percentages, currencies and counts alike.
    name = row["Indicator Name"]
    if name.endswith(")"):
        depth = 0
        for index in range(len(name) - 1, -1, -1):
            if name[index] == ")":
                depth += 1
            elif name[index] == "(":
                depth -= 1
                if depth == 0:
                    return name[index + 1:-1], "indicator title; source Unit of measure is empty"
    return "not specified by source", "source Unit of measure is empty; consult indicator definition"


def _indicators(archive, member):
    indicators, excluded = {}, {}
    with _csv_rows(archive, member, ("Series Code", "Indicator Name", "Unit of measure", "Periodicity", "Source", "License Type"), max_rows=5000) as (_, rows):
        seen = set()
        for row in rows:
            code = row["Series Code"]
            if not re.fullmatch(r"[A-Za-z0-9_.]+", code):
                raise WorldBankImportError(f"WDI indicator metadata contains an invalid code: {code!r}")
            if code in seen:
                raise WorldBankImportError(f"WDI indicator metadata repeats code: {code!r}")
            if not row["Indicator Name"]:
                raise WorldBankImportError(f"WDI indicator metadata has an empty name for code: {code!r}")
            seen.add(code)
            license_name, reason = _license(row)
            if reason:
                excluded[code] = reason
                continue
            row["library_license"] = license_name
            row["library_unit"], row["library_unit_basis"] = _indicator_unit(row)
            indicators[code] = row
    if not indicators:
        raise WorldBankImportError("WDI archive has no indicators permitted for redistribution")
    return indicators, excluded


def _annotation_year(value):
    match = re.fullmatch(r"(?:YR)?(\d{4})", value, re.IGNORECASE)
    if match is None:
        raise WorldBankImportError(f"WDI annotation has an invalid year: {value!r}")
    return int(match.group(1))


class _Annotations:
    """Spool observation footnotes to bounded disposable SQLite scratch."""

    def __init__(self, path):
        self.connection = sqlite3.connect(path)
        self.connection.execute("PRAGMA journal_mode=OFF")
        self.connection.execute("PRAGMA synchronous=OFF")
        self.connection.execute("PRAGMA max_page_count=65536")  # 256 MiB at the default page size.
        self.connection.execute("CREATE TABLE footnotes (country TEXT, indicator TEXT, year TEXT, note TEXT, PRIMARY KEY(country, indicator, year)) WITHOUT ROWID")
        self.country_series = {}
        self.series_time = {}
        self.count = 0

    def close(self):
        self.connection.close()

    def load(self, archive, members, countries, indicators, start, end):
        member = members.get("wdifootnote.csv")
        if member:
            with _csv_rows(archive, member, ("CountryCode", "SeriesCode", "Year", "DESCRIPTION"), max_rows=MAX_ANNOTATION_ROWS) as (_, rows):
                batch = []
                for row in rows:
                    year = _annotation_year(row["Year"])
                    if (row["CountryCode"] not in countries or row["SeriesCode"] not in indicators
                            or not start <= year <= end or not row["DESCRIPTION"]):
                        continue
                    batch.append((row["CountryCode"], row["SeriesCode"], str(year), row["DESCRIPTION"]))
                    self.count += 1
                    if len(batch) == 5000:
                        self._insert(batch)
                        batch.clear()
                self._insert(batch)
            self.connection.commit()
        for filename, required, result in (
            ("wdicountry-series.csv", ("CountryCode", "SeriesCode", "DESCRIPTION"), self.country_series),
            ("wdiseries-time.csv", ("SeriesCode", "Year", "DESCRIPTION"), self.series_time),
        ):
            if filename not in members:
                continue
            with _csv_rows(archive, members[filename], required, max_rows=100_000) as (_, rows):
                for row in rows:
                    if row["SeriesCode"] not in indicators or not row["DESCRIPTION"]:
                        continue
                    if "CountryCode" in row:
                        if row["CountryCode"] not in countries:
                            continue
                        key = (row["CountryCode"], row["SeriesCode"])
                    else:
                        year = _annotation_year(row["Year"])
                        if not start <= year <= end:
                            continue
                        key = (row["SeriesCode"], str(year))
                    if key in result and row["DESCRIPTION"] != result[key]:
                        result[key] += "\n" + row["DESCRIPTION"]
                    else:
                        result[key] = row["DESCRIPTION"]

    def _insert(self, rows):
        self.connection.executemany(
            "INSERT INTO footnotes VALUES (?, ?, ?, ?) ON CONFLICT(country, indicator, year) "
            "DO UPDATE SET note = CASE WHEN note = excluded.note THEN note ELSE note || char(10) || excluded.note END", rows)

    def for_series(self, country, indicator):
        return dict(self.connection.execute(
            "SELECT year, note FROM footnotes WHERE country = ? AND indicator = ?", (country, indicator)))


def _definition(country, indicator, identifier, country_note, archive_evidence):
    unit = indicator["library_unit"]
    code = indicator["Series Code"]
    source_url = f"https://data.worldbank.org/indicator/{code}?locations={country.get('2-alpha code') or country['Country Code']}"
    metadata = {key: value for key, value in indicator.items() if not key.startswith("library_")}
    metadata.update({
        "country_metadata": country, "unit_basis": indicator["library_unit_basis"],
        "license_evidence": "indicator License Type metadata" if indicator.get("License Type") else "World Bank default dataset terms",
        "license_url": IGO_LICENSE_URL if indicator["library_license"] == "CC BY 3.0 IGO" else TERMS_URL,
        "dataset_terms_url": TERMS_URL, "archive_url": ARCHIVE_URL,
        "archive_evidence": archive_evidence,
        "transformation": "Actual economies only; historical years only; missing values omitted; no interpolation or unit conversion.",
    })
    if country_note:
        metadata["country_indicator_note"] = country_note
    return {
        "id": identifier, "source": SOURCE, "dataset": DATASET,
        "entity_id": country["Country Code"], "entity_name": country["Short Name"],
        "entity_type": "country", "country_code": country["Country Code"],
        "indicator_id": code, "indicator_name": indicator["Indicator Name"],
        "unit": unit, "frequency": indicator.get("Periodicity") or "Annual",
        "source_url": source_url, "attribution": "The World Bank: World Development Indicators: " + (indicator["Source"] or "World Bank and original data providers; see indicator metadata"),
        "license": indicator["library_license"], "metadata": metadata,
    }


def _guard_archive_vintage(connection, evidence):
    """A newly retrieved older ZIP must not replace a saved newer WDI release."""
    from scripts.public_data_store import decode_metadata

    # Run after LibraryWriter's BEGIN IMMEDIATE. Checking an earlier read-only
    # connection lets a newer release commit while this archive's notes load.
    # Examine every saved vintage: most-recent retrieval is not necessarily
    # the newest upstream release, and an omitted series retains its evidence.
    for row in connection.execute("SELECT metadata FROM series WHERE source = ? AND dataset = ?", (SOURCE, DATASET)):
        previous = decode_metadata(row[0]).get("archive_evidence", {}).get("data_member_modified")
        if previous and previous > evidence["data_member_modified"]:
            raise WorldBankImportError("An older WDI archive would replace a saved newer source release")


def import_archive(archive_path, database, *, scratch_dir, start_year=1960, end_year=None,
                   max_download_mb=DEFAULT_DOWNLOAD_MB, max_expanded_mb=DEFAULT_EXPANDED_MB,
                   catalog_path=CATALOG_PATH, fetched_at=None, source_last_modified=None):
    """Import one complete archive; any data error aborts the writer transaction."""
    from scripts.public_data_store import LibraryWriter, series_id

    start, end = _year_bounds(start_year, end_year)
    cap = _byte_limit(max_download_mb, "Compressed archive cap")
    archive_path, scratch_dir = Path(archive_path), Path(scratch_dir)
    if not archive_path.is_file() or archive_path.is_symlink() or archive_path.stat().st_size > cap:
        raise WorldBankImportError("Archive must be a regular ZIP file within the compressed size cap")
    if not scratch_dir.is_dir() or scratch_dir.is_symlink():
        raise WorldBankImportError("Choose an existing non-symlink scratch directory")
    catalog = _country_catalog(catalog_path)
    digest = hashlib.sha256()
    with archive_path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    report = {"source": SOURCE, "dataset": DATASET, "start_year": start, "end_year": end,
              "archive_bytes": archive_path.stat().st_size, "archive_sha256": digest.hexdigest(),
              "source_url": DATASET_URL, "terms_url": TERMS_URL, "series_count": 0,
              "observation_count": 0, "empty_series_count": 0, "missing_value_count": 0}
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members, report["archive_expanded_bytes"] = _archive_members(archive, max_expanded_mb=max_expanded_mb)
            evidence = {"sha256": report["archive_sha256"],
                        "data_member_modified": datetime(*members["data"].date_time).isoformat(),
                        "timestamp_basis": "ZIP data member modification time; timezone unspecified"}
            if source_last_modified:
                evidence["provider_last_modified"] = source_last_modified
            report["archive_evidence"] = evidence
            countries, excluded_countries = _countries(archive, members["wdicountry.csv"], catalog)
            indicators, excluded_indicators = _indicators(archive, members["wdiseries.csv"])
            report["excluded_economies"] = sorted(excluded_countries)
            report["excluded_indicators"] = excluded_indicators
            report["eligible_indicator_count"] = len(indicators)
            report["eligible_economy_count"] = len(countries)
            with tempfile.TemporaryDirectory(prefix="wdi-notes-", dir=scratch_dir) as temporary:
                annotations = _Annotations(Path(temporary) / "notes.sqlite3")
                try:
                    annotations.load(archive, members, countries, indicators, start, end)
                    report["retained_footnote_count"] = annotations.count
                    with LibraryWriter(database, SOURCE, DATASET, fetched_at=fetched_at) as writer:
                        _guard_archive_vintage(writer.conn, evidence)
                        seen, populated_countries, populated_indicators = set(), set(), set()
                        with _csv_rows(archive, members["data"], ("Country Name", "Country Code", "Indicator Name", "Indicator Code"), max_rows=MAX_DATA_ROWS) as (header, rows):
                            years = [field for field in header if re.fullmatch(r"\d{4}", field) and start <= int(field) <= end]
                            if not years:
                                raise WorldBankImportError("WDI archive has no columns in the requested year range")
                            for row in rows:
                                country, indicator = row["Country Code"], row["Indicator Code"]
                                if country not in countries or indicator in excluded_indicators:
                                    continue
                                if indicator not in indicators:
                                    raise WorldBankImportError("WDI data refers to an indicator without metadata")
                                key = (country, indicator)
                                if key in seen:
                                    raise WorldBankImportError("WDI data contains a duplicate country/indicator row")
                                seen.add(key)
                                notes, observations = None, []
                                for year in sorted(years):
                                    raw = row[year]
                                    if raw.upper() in MISSING_VALUES:
                                        report["missing_value_count"] += 1
                                        continue
                                    try:
                                        value = float(raw)
                                    except ValueError as exc:
                                        raise WorldBankImportError(f"Invalid WDI value for {country}/{indicator}/{year}") from exc
                                    if not math.isfinite(value):
                                        raise WorldBankImportError(f"Non-finite WDI value for {country}/{indicator}/{year}")
                                    if notes is None:
                                        notes = annotations.for_series(country, indicator)
                                    metadata = {"source_value": raw}
                                    if notes.get(year):
                                        metadata["footnote"] = notes[year]
                                    if annotations.series_time.get((indicator, year)):
                                        metadata["indicator_year_note"] = annotations.series_time[indicator, year]
                                    point = {"period": year, "value": value}
                                    if metadata:
                                        point["metadata"] = metadata
                                    observations.append(point)
                                if not observations:
                                    report["empty_series_count"] += 1
                                    continue
                                definition = _definition(countries[country], indicators[indicator],
                                    series_id(SOURCE, country, indicator, indicators[indicator]["library_unit"]),
                                    annotations.country_series.get(key), evidence)
                                writer.add_series(definition, observations)
                                report["series_count"] += 1
                                report["observation_count"] += len(observations)
                                populated_countries.add(country)
                                populated_indicators.add(indicator)
                        if not report["observation_count"]:
                            raise WorldBankImportError("WDI archive has no usable observations in the requested years")
                        report["economy_count"] = len(populated_countries)
                        report["indicator_count"] = len(populated_indicators)
                    report["writer"] = writer.summary()
                finally:
                    annotations.close()
    except (zipfile.BadZipFile, EOFError, UnicodeError, csv.Error, NotImplementedError, sqlite3.Error) as exc:
        raise WorldBankImportError("WDI archive or annotation scratch failed validation") from exc
    return report


def download_archive(scratch_dir, *, max_download_mb=DEFAULT_DOWNLOAD_MB):
    """Download only the fixed official HTTPS archive, with a streaming byte cap."""
    import requests

    scratch_dir = Path(scratch_dir)
    if not scratch_dir.is_dir() or scratch_dir.is_symlink():
        raise WorldBankImportError("Choose an existing non-symlink scratch directory")
    cap = _byte_limit(max_download_mb, "Download cap")
    path = None
    try:
        with requests.get(ARCHIVE_URL, stream=True, allow_redirects=False, timeout=(15, 90),
                          headers={"User-Agent": "BenchmarkWatcher public historical data importer", "Accept-Encoding": "identity"}) as response:
            if response.status_code != 200:
                raise WorldBankImportError(f"Official WDI archive returned HTTP {response.status_code}; redirects are not followed")
            declared = response.headers.get("Content-Length")
            if declared is not None:
                if not declared.isdigit() or int(declared) > cap:
                    raise WorldBankImportError("Official WDI archive exceeds the download cap")
                declared = int(declared)
            if shutil.disk_usage(scratch_dir).free < (declared or cap) + 200 * 1024 * 1024:
                raise WorldBankImportError("Insufficient disk headroom for the WDI download and bounded scratch")
            count = 0
            with tempfile.NamedTemporaryFile(prefix="wdi-", suffix=".zip", dir=scratch_dir, delete=False) as file:
                path = Path(file.name)
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    count += len(chunk)
                    if count > cap:
                        raise WorldBankImportError("Official WDI archive exceeded the streaming download cap")
                    file.write(chunk)
            if declared is not None and count != declared:
                raise WorldBankImportError("Official WDI archive download was truncated")
            return path, {"download_bytes": count, "source_last_modified": response.headers.get("Last-Modified")}
    except (requests.RequestException, OSError) as exc:
        if path is not None:
            path.unlink(missing_ok=True)
        raise WorldBankImportError("Official WDI archive download failed") from exc
    except Exception:
        if path is not None:
            path.unlink(missing_ok=True)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--scratch-dir", type=Path, required=True, help="Existing session-owned scratch directory")
    parser.add_argument("--archive", type=Path, help="Existing official ZIP; makes no network requests")
    parser.add_argument("--start-year", type=int, default=1960,
                        help="First historical year; default includes the WDI archive from 1960")
    parser.add_argument("--end-year", type=int, default=date.today().year - 1)
    parser.add_argument("--max-download-mb", type=float, default=DEFAULT_DOWNLOAD_MB)
    parser.add_argument("--max-expanded-mb", type=float, default=DEFAULT_EXPANDED_MB)
    parser.add_argument("--keep-download", action="store_true", help="Retain only this command's downloaded archive for offline refresh")
    args = parser.parse_args(argv)
    downloaded = None
    try:
        _year_bounds(args.start_year, args.end_year)
        _byte_limit(args.max_download_mb, "Download cap")
        _byte_limit(args.max_expanded_mb, "Expanded archive cap")
        download_report = {}
        archive = args.archive
        if archive is None:
            downloaded, download_report = download_archive(args.scratch_dir, max_download_mb=args.max_download_mb)
            archive = downloaded
        report = import_archive(archive, args.database, scratch_dir=args.scratch_dir,
            start_year=args.start_year, end_year=args.end_year,
            max_download_mb=args.max_download_mb, max_expanded_mb=args.max_expanded_mb,
            source_last_modified=download_report.get("source_last_modified"))
        report.update(download_report)
        if downloaded is not None and args.keep_download:
            report["retained_archive"] = str(downloaded)
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 0
    except (ValueError, OSError) as exc:
        print(f"World Bank import failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if downloaded is not None and not args.keep_download:
            downloaded.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
