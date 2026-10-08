"""Import official FAOSTAT normalized bulk CSVs into the public data library.

The live dataset inventory comes from FAO's official datasets_E.xml manifest.
Only explicitly reviewed annual country schema profiles can be imported; other
domains remain visible in the catalog with the work needed to support them.
ZIP members are read directly, never extracted. Bounded batches also support
TCL's interleaved country/year rows without keeping the corpus in memory.
Importing this module performs no network or database operations.
"""

from __future__ import annotations

import argparse
from collections import Counter, OrderedDict
from contextlib import contextmanager
import csv
from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
from urllib.parse import urlsplit

import requests

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.public_data_store import LibraryWriter, decode_metadata, series_id
from scripts.faostat_catalog import BLANK_UNIT_RESOLUTIONS, BULK_BASE, DATASETS, DOMAIN_LIMITATIONS, Dataset


MANIFEST_URL = "https://bulks-faostat.fao.org/production/datasets_E.xml"
TERMS_URL = "https://www.fao.org/contact-us/terms/db-terms-of-use/"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
LICENSE = "CC-BY-4.0"
USER_AGENT = "BenchmarkWatcher/1.0 (official historical reference data importer)"
MIB = 1024 * 1024


class FAOSTATError(ValueError):
    """Invalid, incomplete or out-of-bounds upstream data; do not publish it."""


@dataclass(frozen=True)
class Limits:
    max_archive_bytes: int = 350 * MIB
    max_uncompressed_bytes: int = 3 * 1024 * MIB
    max_rows: int = 25_000_000
    batch_size: int = 25_000
    max_field_bytes: int = 65_536
    max_manifest_bytes: int = 2 * MIB
    max_members: int = 32
    max_compression_ratio: int = 250
    request_timeout: int = 60
    max_seconds: int = 1800

    def __post_init__(self):
        for field in self.__dataclass_fields__:
            if type(getattr(self, field)) is not int or getattr(self, field) <= 0:
                raise FAOSTATError("Limits must be positive integers: " + field)
        if self.batch_size > 100_000 or self.request_timeout > 300:
            raise FAOSTATError("Batch size or request timeout exceeds its safety cap")


REQUIRED_HEADERS = {"Area Code", "Area", "Item Code", "Item", "Element Code", "Element", "Year", "Unit", "Value", "Flag"}
OPTIONAL_HEADERS = {"Area Code (M49)", "Item Code (CPC)", "Item Code (FBS)", "Year Code", "Note"}
MIN_HISTORICAL_YEAR = 1900
# These are explicit roll-ups in the official AreaCodes companions, despite
# their small FAO codes. China 351/M49 159 is distinct from mainland 41/156.
AGGREGATE_AREA_CODES = {261, 265, 266, 268, 269, 351}
MISSING_FLAGS = {"L", "M", "O", "Q"}
MISSING_VALUES = {"", "..", "...", "na", "n/a", "null", "nan", "-"}

# Durable coverage evidence is committed with the observations, not inferred
# from the most recent series date or from the existence of an importer.
FAOSTAT_IMPORT_RUN_SCHEMA = """
CREATE TABLE IF NOT EXISTS faostat_import_runs (
    dataset TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    source_updated_at TEXT,
    start_year INTEGER NOT NULL,
    end_year INTEGER NOT NULL,
    archive_name TEXT NOT NULL,
    archive_bytes INTEGER NOT NULL,
    rows_read INTEGER NOT NULL,
    observations_imported INTEGER NOT NULL,
    skipped_counts TEXT NOT NULL,
    PRIMARY KEY (dataset, checked_at)
)
"""


def _dataset(code):
    try:
        return DATASETS[code]
    except KeyError as exc:
        raise FAOSTATError("Unsupported FAOSTAT dataset: " + str(code)) from exc


def _years(start_year, end_year):
    start_year = MIN_HISTORICAL_YEAR if start_year is None else start_year
    end_year = date.today().year - 1 if end_year is None else end_year
    if (type(start_year) is not int or type(end_year) is not int or
            not MIN_HISTORICAL_YEAR <= start_year <= end_year < date.today().year):
        raise FAOSTATError("FAOSTAT bounds must be historical years from 1900 onward")
    return start_year, end_year


def _code(value, field):
    value = str(value or "").strip().removeprefix("'")
    if not re.fullmatch(r"\d+", value) or int(value) <= 0:
        raise FAOSTATError("Invalid FAOSTAT " + field)
    return str(int(value))


def _m49(value):
    value = str(value or "").strip().removeprefix("'")
    if value and not re.fullmatch(r"\d{1,3}(?:\.\d+)?", value):
        raise FAOSTATError("Invalid FAOSTAT M49 code")
    return value.zfill(3) if value and "." not in value else value


def is_country_area(area_code, m49="", name=""):
    """Country/territory series only; exclude world, region and China roll-ups."""
    code = int(area_code)
    return (0 < code < 1000 and code not in AGGREGATE_AREA_CODES and
            "." not in m49 and m49 != "159" and
            "excluding intra-trade" not in name.casefold())


def _source_update(value):
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.removesuffix("Z")).date().isoformat()
    except (TypeError, ValueError) as exc:
        raise FAOSTATError("Invalid source update date") from exc


@contextmanager
def _csv_reader(stream, limits):
    previous = csv.field_size_limit()
    csv.field_size_limit(limits.max_field_bytes)
    try:
        reader = csv.DictReader(stream, strict=True)
        headers = reader.fieldnames
        if not headers or len(headers) != len(set(h.strip() for h in headers)):
            raise FAOSTATError("Missing or duplicated FAOSTAT CSV headers")
        reader.fieldnames = [h.strip() for h in headers]
        yield reader
    except (csv.Error, UnicodeError) as exc:
        raise FAOSTATError("Malformed FAOSTAT CSV: " + str(exc)) from exc
    finally:
        csv.field_size_limit(previous)


def _validate_row_shape(row):
    if None in row or any(value is None for value in row.values()):
        raise FAOSTATError("FAOSTAT row does not match its header")


def _validate_headers(headers, spec):
    required = REQUIRED_HEADERS.copy()
    if spec.measure != "Element":
        required.difference_update({"Element Code", "Element"})
        required.update({spec.measure + " Code", spec.measure})
    for dimension in spec.dimensions:
        required.update({dimension + " Code", dimension})
    present = set(headers)
    if not required <= present:
        raise FAOSTATError("Missing required normalized FAOSTAT CSV headers")
    extra = present - required - OPTIONAL_HEADERS
    if extra:
        raise FAOSTATError("Unsupported FAOSTAT dimensions/columns would lose identity: " + ", ".join(sorted(extra)))


def _forecast_label(value):
    return bool(re.search(r"\b(?:forecast\w*|project(?:ed|ion|ions)|scenario\w*|planned)\b", value, re.IGNORECASE))


def parse_row(row, *, dataset="QCL", start_year=None, end_year=None,
              flags=None, source_updated=None, accessed_on=None, _definitions=None,
              _headers_validated=False):
    """Return (definition, observation), or (None, reason) for an excluded row."""
    spec = _dataset(dataset)
    start_year, end_year = _years(start_year, end_year)
    _validate_row_shape(row)
    if not _headers_validated:
        _validate_headers(row, spec)
    year_text = row["Year"].strip()
    if not re.fullmatch(r"\d{4}", year_text):
        raise FAOSTATError("Invalid FAOSTAT year")
    if row.get("Year Code", year_text).strip() != year_text:
        raise FAOSTATError("FAOSTAT year and year code disagree")
    year = int(year_text)
    if not start_year <= year <= end_year:
        return None, "year"
    area_code = _code(row["Area Code"], "area code")
    m49 = _m49(row.get("Area Code (M49)", ""))
    area_name = row["Area"].strip()
    if not is_country_area(area_code, m49, area_name):
        return None, "aggregate"
    flag = row["Flag"].strip()
    raw_value = row["Value"].strip()
    if flag in MISSING_FLAGS or raw_value.casefold() in MISSING_VALUES:
        return None, "missing"
    if flag == "F" or _forecast_label((flags or {}).get(flag, "")):
        return None, "forecast"
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise FAOSTATError("Invalid FAOSTAT numeric value") from exc
    if not math.isfinite(value):
        raise FAOSTATError("Non-finite FAOSTAT numeric value")
    item_code = _code(row["Item Code"], "item code")
    element_code = _code(row[spec.measure + " Code"], spec.measure.lower() + " code")
    item_name, element_name, unit = (row[key].strip() for key in ("Item", spec.measure, "Unit"))
    unit_resolution = None
    if not unit:
        reviewed = BLANK_UNIT_RESOLUTIONS.get((dataset, element_code))
        if reviewed and reviewed["element_name"] == element_name:
            unit = reviewed["unit"]
            unit_resolution = {
                "source_unit": row["Unit"], "resolved_unit": unit,
                "source_url": reviewed["source_url"], "basis": reviewed["basis"],
            }
    if not all((area_name, item_name, element_name, unit)):
        raise FAOSTATError("Missing FAOSTAT series name or unit")
    cpc = row.get("Item Code (CPC)", "").strip().removeprefix("'")
    fbs = row.get("Item Code (FBS)", "").strip().removeprefix("'")
    dimensions = {}
    for name in spec.dimensions:
        code = _code(row[name + " Code"], name.lower() + " code")
        label = row[name].strip()
        if not label:
            raise FAOSTATError("Missing FAOSTAT dimension name: " + name)
        if _forecast_label(label):
            return None, "forecast"
        dimensions[name] = {"code": code, "name": label}
    entity_id = "FAO:" + area_code
    indicator_id = ":".join((dataset, item_code, element_code))
    for name, dimension in dimensions.items():
        indicator_id += ":" + name.casefold() + "=" + dimension["code"]
    # Keep the original numeric lexeme for exact tables/exports; the float is
    # only the calculation/plotting representation, which may lose precision.
    observation_metadata = {"source_value": raw_value}
    if unit_resolution:
        observation_metadata["source_unit"] = row["Unit"]
        observation_metadata["unit_resolution_source"] = unit_resolution["source_url"]
    if flag:
        observation_metadata["flag"] = flag
    note = row.get("Note", "").strip()
    if note:
        observation_metadata["note"] = note
    observation = {"period": year_text, "value": value, "metadata": observation_metadata}
    # The importer passes a cache scoped to one archive/release. QCL contains
    # decades per adjacent series; TCL revisits interleaved series. Avoid
    # repeating hashing/citation construction for each of millions of rows.
    dimension_labels = tuple((name, dimension["name"]) for name, dimension in dimensions.items())
    cache_key = (entity_id, indicator_id, unit, area_name, m49, item_name, element_name, cpc, fbs, dimension_labels,
                 row["Unit"] if unit_resolution else None)
    if _definitions is not None and cache_key in _definitions:
        _definitions.move_to_end(cache_key)
        return _definitions[cache_key], observation
    access_date = accessed_on or date.today()
    update = _source_update(source_updated)
    attribution = (f"FAO. {update[:4] if update else 'n.d.'}. FAOSTAT: {spec.name}. "
                   f"[Accessed on {access_date.strftime('%d %B %Y')}]. {spec.source_url} "
                   "Licence: CC-BY-4.0.")
    metadata = {
        "area_code": area_code, "area_code_m49": m49,
        "country_code_system": "UN M49" if m49 else "FAO area code only",
        "statistical_entity": "country_or_territory",
        "item_code": item_code, "item_code_cpc": cpc,
        "item_code_fbs": fbs,
        "element_code": element_code, "element_name": element_name,
        "measure_dimension": spec.measure, "source_dimensions": dimensions,
        "download_url": spec.archive_url, "manifest_url": MANIFEST_URL,
        "source_updated_at": update, "flag_definitions": flags or {},
        "license_url": LICENSE_URL, "terms_url": TERMS_URL,
        "license_conditions": "CC BY 4.0 unless dataset metadata/page specifies otherwise, with FAO Statistical Database Terms of Use; no endorsement or promotional use; third-party exceptions may apply.",
        "transformations": "Country/territory and historical-year selection; source units and numeric values unchanged.",
    }
    if unit_resolution:
        metadata["source_unit"] = row["Unit"]
        metadata["unit_resolution"] = unit_resolution
        metadata["transformations"] = "Country/territory and historical-year selection; blank CSV unit retained in metadata and labeled using the official FAO dataset metadata; numeric values unchanged."
    definition = {
        "id": series_id("faostat", entity_id, indicator_id, unit),
        "source": "faostat", "dataset": dataset,
        "entity_id": entity_id, "entity_name": area_name, "entity_type": "country",
        "country_code": m49, "indicator_id": indicator_id,
        "indicator_name": item_name + " — " + element_name + "".join(" — " + d["name"] for d in dimensions.values()),
        "unit": unit, "frequency": "annual", "source_url": spec.source_url,
        "attribution": attribution, "license": LICENSE, "metadata": metadata,
    }
    if _definitions is not None:
        _definitions[cache_key] = definition
        if len(_definitions) > 4096:
            _definitions.popitem(last=False)
    return definition, observation


def _validate_archive(archive, path, spec, limits):
    if path.stat().st_size > limits.max_archive_bytes:
        raise FAOSTATError("FAOSTAT archive exceeds compressed-size bound")
    members = archive.infolist()
    if len(members) > limits.max_members or not members:
        raise FAOSTATError("FAOSTAT ZIP member count exceeds its bound")
    names = [info.filename for info in members]
    if len(names) != len(set(names)):
        raise FAOSTATError("Duplicate FAOSTAT ZIP member")
    total = 0
    for info in members:
        parts = PurePosixPath(info.filename)
        if (parts.is_absolute() or len(parts.parts) != 1 or "\\" in info.filename or
                info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000):
            raise FAOSTATError("Unsafe FAOSTAT ZIP member")
        if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise FAOSTATError("Unsupported FAOSTAT ZIP compression")
        total += info.file_size
        if info.file_size > limits.max_compression_ratio * max(info.compress_size, 1):
            raise FAOSTATError("FAOSTAT ZIP compression ratio exceeds its bound")
    if total > limits.max_uncompressed_bytes:
        raise FAOSTATError("FAOSTAT archive exceeds uncompressed-size bound")
    if spec.csv_name not in names:
        raise FAOSTATError("Expected normalized CSV is absent for " + spec.code)
    return archive.getinfo(spec.csv_name)


def _read_flags(archive, spec, limits):
    name = spec.companion("Flags")
    if name not in archive.namelist():
        return {}
    if archive.getinfo(name).file_size > MIB:
        raise FAOSTATError("FAOSTAT flags table exceeds its bound")
    with archive.open(name) as binary, io.TextIOWrapper(binary, encoding="utf-8-sig") as stream:
        with _csv_reader(stream, limits) as rows:
            if not {"Flag", "Description"} <= set(rows.fieldnames):
                raise FAOSTATError("Malformed FAOSTAT flags table")
            result = {}
            for row in rows:
                _validate_row_shape(row)
                flag, description = row["Flag"].strip(), row["Description"].strip()
                if not flag or flag in result or len(result) >= 100:
                    raise FAOSTATError("Invalid or duplicate FAOSTAT flag")
                result[flag] = description
            return result


def _guard_source_vintage(connection, dataset, source_updated):
    """Retrieval time cannot make an old or unknown archive a newer release.

    Check every saved series: a narrower prior refresh may have left different
    source vintages within a dataset. Run under the writer's transaction lock so
    another refresh cannot commit a newer source between the check and writes.
    """
    for (encoded,) in connection.execute(
            "SELECT metadata FROM series WHERE source=? AND dataset=?", ("faostat", dataset)):
        previous = _source_update(decode_metadata(encoded).get("source_updated_at"))
        if previous is not None:
            if source_updated is None:
                raise FAOSTATError("A source update date is required to refresh a known-version FAOSTAT dataset; previous data preserved")
            if source_updated < previous:
                raise FAOSTATError("An older FAOSTAT source release would replace a saved newer release; previous data preserved")


def import_faostat_archive(archive_path, database_path, *, dataset="QCL",
                           start_year=None, end_year=None, limits=None,
                           source_updated=None, fetched_at=None, encoding="utf-8-sig"):
    """Atomically merge one full bulk member, preserving history and revisions."""
    limits = limits or Limits()
    spec = _dataset(dataset)
    start_year, end_year = _years(start_year, end_year)
    source_updated = _source_update(source_updated)
    path = Path(archive_path)
    archive_bytes = path.stat().st_size
    if archive_bytes > limits.max_archive_bytes:
        raise FAOSTATError("FAOSTAT archive exceeds compressed-size bound")
    started = time.monotonic()
    counters = Counter()
    accessed_on = date.today()
    try:
        with zipfile.ZipFile(path) as archive:
            member = _validate_archive(archive, path, spec, limits)
            flags = _read_flags(archive, spec, limits)
            writer = LibraryWriter(database_path, "faostat", dataset, fetched_at=fetched_at)
            with writer:
                _guard_source_vintage(writer.conn, dataset, source_updated)
                prior = writer.conn.execute(
                    "SELECT checked_at FROM datasets WHERE source=? AND dataset=?", ("faostat", dataset)).fetchone()
                if prior and prior[0] == writer.stamp:
                    raise FAOSTATError("A FAOSTAT import must use a distinct retrieval timestamp to detect duplicate source observations")
                pending = {}
                buffered = 0
                definitions = OrderedDict()

                def flush():
                    if time.monotonic() - started > limits.max_seconds:
                        raise FAOSTATError("FAOSTAT import exceeded its time bound; refresh rolled back")
                    for definition, observations, periods in pending.values():
                        # A row revisited after a flush must not silently turn
                        # into a revision of another row in the same archive.
                        placeholders = ",".join("?" for _ in periods)
                        collision = writer.conn.execute(
                            "SELECT 1 FROM observations WHERE series_id=? AND checked_at=? AND period IN (" + placeholders + ") LIMIT 1",
                            (definition["id"], writer.stamp, *periods)).fetchone()
                        if collision:
                            raise FAOSTATError("Duplicate FAOSTAT source observation; refresh rolled back")
                        writer.add_series(definition, observations)
                    pending.clear()

                with archive.open(member) as binary, io.TextIOWrapper(binary, encoding=encoding) as stream:
                    with _csv_reader(stream, limits) as rows:
                        _validate_headers(rows.fieldnames, spec)
                        for row in rows:
                            counters["rows_read"] += 1
                            if counters["rows_read"] > limits.max_rows:
                                raise FAOSTATError("FAOSTAT row count exceeds its bound; refresh rolled back")
                            if counters["rows_read"] % 1000 == 0 and time.monotonic() - started > limits.max_seconds:
                                raise FAOSTATError("FAOSTAT import exceeded its time bound; refresh rolled back")
                            definition, observation = parse_row(
                                row, dataset=dataset, start_year=start_year, end_year=end_year,
                                flags=flags, source_updated=source_updated, accessed_on=accessed_on,
                                _definitions=definitions, _headers_validated=True)
                            if definition is None:
                                counters["skipped_" + observation] += 1
                                continue
                            key = definition["id"]
                            if key not in pending:
                                pending[key] = (definition, [], set())
                            if observation["period"] in pending[key][2]:
                                raise FAOSTATError("Duplicate FAOSTAT source observation; refresh rolled back")
                            pending[key][1].append(observation)
                            pending[key][2].add(observation["period"])
                            buffered += 1
                            counters["observations_imported"] += 1
                            if buffered >= limits.batch_size:
                                flush()
                                buffered = 0
                        flush()
                writer.conn.execute(FAOSTAT_IMPORT_RUN_SCHEMA)
                skipped = {key.removeprefix("skipped_"): value for key, value in counters.items() if key.startswith("skipped_")}
                writer.conn.execute(
                    "INSERT INTO faostat_import_runs VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (dataset, writer.stamp, source_updated, start_year, end_year,
                     path.name, archive_bytes, counters["rows_read"], counters["observations_imported"],
                     json.dumps(skipped, sort_keys=True, separators=(",", ":"))))
            summary = writer.summary()
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise FAOSTATError("Unable to read complete FAOSTAT archive: " + str(exc)) from exc
    summary.update(counters)
    summary.update(start_year=start_year, end_year=end_year, archive_bytes=archive_bytes,
                   source_updated_at=source_updated, elapsed_seconds=round(time.monotonic() - started, 3))
    return summary


def _http_chunks(session, url, limits, *, maximum):
    """Enforce advertised and actual bytes, even when Content-Length is absent."""
    started = time.monotonic()
    with session.get(url, stream=True, timeout=(10, limits.request_timeout),
                     headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}, allow_redirects=False) as response:
        response.raise_for_status()
        if response.status_code != 200:
            raise FAOSTATError("Official FAOSTAT endpoint returned an incomplete response")
        length_text = response.headers.get("Content-Length")
        try:
            length = int(length_text) if length_text else None
        except ValueError as exc:
            raise FAOSTATError("Invalid FAOSTAT Content-Length") from exc
        if length is not None and not 0 < length <= maximum:
            raise FAOSTATError("FAOSTAT download exceeds its byte bound")
        count = 0
        for chunk in response.iter_content(64 * 1024):
            if not chunk:
                continue
            count += len(chunk)
            if count > maximum or time.monotonic() - started > limits.max_seconds:
                raise FAOSTATError("FAOSTAT download exceeds its byte/time bound")
            yield chunk
        if not count or (length is not None and count != length):
            raise FAOSTATError("Incomplete FAOSTAT download")


def _manifest_integer(value, field):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9]\d*", value):
        raise FAOSTATError("Invalid FAOSTAT manifest " + field)
    return int(value)


def parse_manifest(content):
    """Discover every official domain, including explicit unsupported entries.

    Inventory is distinct from import coverage: neither a compatible schema
    profile nor a manifest entry means that its observations are already saved.
    """
    if not isinstance(content, bytes) or not 0 < len(content) <= Limits.max_manifest_bytes:
        raise FAOSTATError("FAOSTAT manifest exceeds its byte bound or is empty")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeError as exc:
        raise FAOSTATError("FAOSTAT manifest must use UTF-8") from exc
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise FAOSTATError("Unsupported FAOSTAT manifest declarations")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise FAOSTATError("Malformed FAOSTAT manifest") from exc
    if root.tag != "Datasets" or not len(root):
        raise FAOSTATError("Missing official FAOSTAT manifest dataset inventory")
    result, codes = [], set()
    for node in root:
        code = node.findtext("DatasetCode") or ""
        if not re.fullmatch(r"[A-Z][A-Z0-9]{0,11}", code) or code in codes:
            raise FAOSTATError("Invalid or duplicated FAOSTAT manifest dataset code")
        codes.add(code)
        spec = DATASETS.get(code)
        name = node.findtext("DatasetName") or (spec.name if spec else "")
        if not name or len(name) > 500 or not name.isprintable():
            raise FAOSTATError("Invalid FAOSTAT manifest dataset name")
        url = node.findtext("FileLocation") or ""
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.netloc != "bulks-faostat.fao.org" or
                parsed.query or parsed.fragment or not re.fullmatch(
                    r"/production/[A-Za-z0-9][A-Za-z0-9_() .-]*\.(?:zip|csv|xlsx|gz)", parsed.path)):
            raise FAOSTATError("Official FAOSTAT manifest archive URL changed or is unverified")
        if (not parsed.path.endswith("_E_All_Data_(Normalized).zip") or
                node.findtext("CompressionFormat", "zip").lower() != "zip" or
                node.findtext("FileType", "csv").lower() != "csv"):
            status, reason = "unsupported_format", "A normalized CSV ZIP archive is required."
        elif spec and url != spec.archive_url:
            status, reason = "source_changed", "The official archive URL changed; review its schema before importing."
        elif spec:
            status, reason = "supported", "Reviewed annual country/territory schema; archive headers and historical rows are validated at import."
        else:
            status, reason = DOMAIN_LIMITATIONS.get(
                code, ("schema_review_required", "Normalized archive discovered; dimensions, periods, forecasts and dataset-specific terms need review."))
        size = node.findtext("FileSize") or ""
        size_match = re.fullmatch(r"([1-9]\d*)(KB|MB|GB|B)", size, re.IGNORECASE)
        if not size_match:
            raise FAOSTATError("Invalid FAOSTAT manifest file size")
        reported_size_bytes = int(size_match[1]) * {"B": 1, "KB": 1024, "MB": MIB, "GB": 1024 * MIB}[size_match[2].upper()]
        rows = node.findtext("FileRows") or ""
        result.append({
            "dataset": code, "name": name, "url": url,
            "source_url": "https://www.fao.org/faostat/en/#data/" + code,
            "source_updated": _source_update(node.findtext("DateUpdate")),
            "reported_size": size, "reported_size_bytes": reported_size_bytes,
            "reported_rows": rows, "reported_row_count": _manifest_integer(rows, "row count"),
            "support_status": status, "support_reason": reason,
            "dimensions": list(spec.dimensions) if spec else None,
            "measure_dimension": spec.measure if spec else None,
            "description": node.findtext("DatasetDescription") or "",
            "topic": node.findtext("Topic") or "",
            "license": LICENSE, "license_url": LICENSE_URL, "terms_url": TERMS_URL,
            "license_scope": "FAO default license; dataset metadata/page and third-party exceptions remain controlling.",
            "coverage_status": "inventory_only",
        })
    return sorted(result, key=lambda entry: entry["dataset"])


def fetch_catalog(session, limits=None):
    """Bounded live discovery; no archive download or database writes."""
    limits = limits or Limits()
    content = b"".join(_http_chunks(session, MANIFEST_URL, limits, maximum=limits.max_manifest_bytes))
    return parse_manifest(content)


def fetch_release(session, dataset="QCL", limits=None):
    """Read the official inventory and select one reviewed import profile."""
    _dataset(dataset)
    matches = [entry for entry in fetch_catalog(session, limits) if entry["dataset"] == dataset]
    if len(matches) != 1:
        raise FAOSTATError("Dataset absent or duplicated in official FAOSTAT manifest")
    release = matches[0]
    if release["support_status"] == "source_changed":
        raise FAOSTATError("Official FAOSTAT dataset download URL changed; verify it before import")
    if release["support_status"] != "supported":
        raise FAOSTATError("Unsupported FAOSTAT release: " + release["support_reason"])
    if release["source_updated"] is None:
        raise FAOSTATError("Official FAOSTAT manifest release date is required before import")
    return release


def download_archive(session, release, destination, limits=None):
    """Write one new session scratch file; never overwrite an existing file."""
    limits = limits or Limits()
    spec = _dataset(release["dataset"])
    if release["url"] != spec.archive_url:
        raise FAOSTATError("Refusing an unverified FAOSTAT archive URL")
    destination = Path(destination)
    digest = hashlib.sha256()
    with destination.open("xb") as handle:
        for chunk in _http_chunks(session, spec.archive_url, limits, maximum=limits.max_archive_bytes):
            digest.update(chunk)
            handle.write(chunk)
    return digest.hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path)
    parser.add_argument("--catalog", action="store_true", help="Discover all official manifest domains and print their support status; no archive/database operations")
    parser.add_argument("--scratch-dir", type=Path)
    parser.add_argument("--dataset", choices=DATASETS, default="QCL")
    parser.add_argument("--start-year", type=int, help="First historical year to include (default: full available annual history from 1900)")
    parser.add_argument("--end-year", type=int)
    parser.add_argument("--archive", type=Path, help="Existing offline official normalized ZIP; no network requests")
    parser.add_argument("--source-updated", help="Official offline archive release date; required when refreshing a known-version dataset")
    parser.add_argument("--batch-size", type=int, default=Limits.batch_size)
    parser.add_argument("--max-archive-mb", type=int, default=350)
    parser.add_argument("--max-uncompressed-mb", type=int, default=3072)
    parser.add_argument("--max-rows", type=int, default=Limits.max_rows)
    parser.add_argument("--timeout", type=int, default=Limits.request_timeout)
    parser.add_argument("--max-seconds", type=int, default=Limits.max_seconds)
    parser.add_argument("--encoding", choices=("utf-8-sig", "utf-8", "latin-1"), default="utf-8-sig")
    args = parser.parse_args(argv)
    try:
        if args.catalog:
            with requests.Session() as session:
                catalog = fetch_catalog(session)
            print(json.dumps({"source": "faostat", "manifest_url": MANIFEST_URL,
                              "dataset_count": len(catalog), "datasets": catalog}, ensure_ascii=False, allow_nan=False, sort_keys=True))
            return 0
        if args.database is None:
            raise FAOSTATError("An import requires --database; use --catalog for inventory discovery")
        _years(args.start_year, args.end_year)
        limits = Limits(max_archive_bytes=args.max_archive_mb * MIB,
                        max_uncompressed_bytes=args.max_uncompressed_mb * MIB,
                        max_rows=args.max_rows, batch_size=args.batch_size,
                        request_timeout=args.timeout, max_seconds=args.max_seconds)
        options = dict(dataset=args.dataset, start_year=args.start_year, end_year=args.end_year,
                       limits=limits, encoding=args.encoding)
        if args.archive:
            result = import_faostat_archive(args.archive, args.database,
                                           source_updated=args.source_updated, **options)
        else:
            if not args.scratch_dir or not args.scratch_dir.is_dir() or args.scratch_dir.is_symlink():
                raise FAOSTATError("Online import requires an existing session-owned --scratch-dir")
            if shutil.disk_usage(args.scratch_dir).free < limits.max_archive_bytes + 256 * MIB:
                raise FAOSTATError("Insufficient scratch headroom for bounded FAOSTAT download")
            with requests.Session() as session:
                release = fetch_release(session, args.dataset, limits)
                with tempfile.TemporaryDirectory(prefix="faostat-", dir=args.scratch_dir) as directory:
                    archive = Path(directory) / "archive.zip"
                    archive_hash = download_archive(session, release, archive, limits)
                    result = import_faostat_archive(archive, args.database,
                                                   source_updated=release["source_updated"], **options)
                    result.update(archive_sha256=archive_hash, official_release=release)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True))
        return 0
    except (FAOSTATError, requests.RequestException, ValueError, OSError) as exc:
        print(json.dumps({"source": "faostat", "dataset": args.dataset, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
