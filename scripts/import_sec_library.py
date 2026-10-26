#!/usr/bin/env python3
"""Import bounded, public SEC XBRL frames into the maintained data library.

Annual frames are calendar-aligned selections, not aligned company fiscal years.
Actual reporting intervals, distinct XBRL concepts and currencies remain separate.
"""

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import time
from dataclasses import dataclass
from contextlib import closing
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import requests

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DOCUMENTATION_URL = "https://www.sec.gov/search-filings/edgar-application-programming-interfaces"
DEFAULT_USER_AGENT = "BenchmarkWatcher https://benchmarkwatcher.online (research application)"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_FRAME_FACTS = 50000
MAX_REQUESTS = 500
CATALOG_PATH = Path(__file__).with_name("sec_concepts.json")
MAX_CATALOG_BYTES = 4 * 1024 * 1024


class SECImportError(ValueError):
    """A source response or requested scope cannot be imported safely."""


class _NoPublishedFrames(SECImportError):
    """A validated scan found only explicitly unavailable source frames."""


@dataclass(frozen=True)
class Concept:
    tag: str
    name: str
    instant: bool = False
    taxonomy: str = "us-gaap"
    unit: str = "USD"
    official_label: str = ""
    data_type: str = ""
    metadata_source: str = ""


# Revenue concepts are deliberately separate; their definitions are not synonyms.
ORIGINAL_CONCEPTS = (
    Concept("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenue from customer contracts, excluding assessed tax"),
    Concept("Revenues", "Revenues"),
    Concept("SalesRevenueNet", "Sales revenue, net"),
    Concept("Assets", "Total assets", instant=True),
    Concept("NetIncomeLoss", "Net income (loss)"),
    Concept("NetCashProvidedByUsedInOperatingActivities", "Net cash from operating activities"),
    Concept("StockholdersEquity", "Stockholders' equity", instant=True),
    Concept("CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", instant=True),
)


def _read_catalog(path: Path) -> dict:
    path = Path(path)
    if path.stat().st_size > MAX_CATALOG_BYTES:
        raise SECImportError("SEC concept catalog exceeds the size limit")
    with path.open(encoding="utf-8") as stream:
        payload = json.load(stream)
    if not isinstance(payload, dict):
        raise SECImportError("SEC concept catalog must be an object")
    return payload


def _official_catalog() -> tuple[dict, tuple[Concept, ...]]:
    """Resolve every label, period and financial type from checked-in metadata."""
    payload = _read_catalog(CATALOG_PATH)
    rows = payload.get("concepts")
    if payload.get("version") != 1 or not isinstance(rows, list) or not 1 <= len(rows) <= 20000:
        raise SECImportError("Invalid official SEC financial catalog")
    allowed_types = {"xbrli:monetaryItemType": "USD", "xbrli:sharesItemType": "shares",
                     "dtr-types:perShareItemType": "USD/shares"}
    concepts, seen = [], set()
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("tag"), str)
                or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,300}", row["tag"])
                or row["tag"] in seen or row.get("period_type") not in ("instant", "duration")
                or row.get("data_type") not in allowed_types
                or row.get("unit") != allowed_types[row["data_type"]]
                or row.get("metadata_source") not in payload.get("sources", {})
                or not isinstance(row.get("name"), str) or not row["name"].strip()
                or not row["name"].isprintable() or len(row["name"]) > 1000):
            raise SECImportError("SEC catalog concept lacks valid official financial metadata")
        seen.add(row["tag"])
        concepts.append(Concept(row["tag"], row["name"], row["period_type"] == "instant", unit=row["unit"],
                                official_label=row["name"], data_type=row["data_type"],
                                metadata_source=row["metadata_source"]))
    core = payload.get("core_tags")
    if (not isinstance(core, list) or not core or len(set(core)) != len(core)
            or any(tag not in seen for tag in core)):
        raise SECImportError("SEC core selection contains unknown or duplicate concepts")
    return payload, tuple(concepts)


CATALOG, ALL_CONCEPTS = _official_catalog()
_BY_TAG = {concept.tag: concept for concept in ALL_CONCEPTS}
_ORIGINAL_NAMES = {concept.tag: concept.name for concept in ORIGINAL_CONCEPTS}
CONCEPTS = tuple(Concept(concept.tag, _ORIGINAL_NAMES.get(tag, concept.name), concept.instant,
                         concept.taxonomy, concept.unit, concept.official_label,
                         concept.data_type, concept.metadata_source)
                 for tag in CATALOG["core_tags"] for concept in (_BY_TAG[tag],))
LEGACY_CONCEPTS = CONCEPTS[:len(ORIGINAL_CONCEPTS)]


def load_concepts(path: Path) -> tuple[Concept, ...]:
    """Select known taxonomy concepts; a selection cannot invent tags or labels.

    JSON format: {"concepts":[{"tag":"Assets","unit":"EUR"}, ...]}.
    Units may explicitly select other ISO currency codes; none are converted.
    The checked-in complete official catalog is also accepted as a selection.
    """
    rows = _read_catalog(path).get("concepts")
    if not isinstance(rows, list) or not 1 <= len(rows) <= len(ALL_CONCEPTS):
        raise SECImportError("Select one or more known SEC financial concepts")
    concepts = []
    for row in rows:
        if not isinstance(row, dict) or row.get("taxonomy", "us-gaap") != "us-gaap":
            raise SECImportError("Selections must use the validated US-GAAP catalog")
        tag = row.get("tag")
        base = _BY_TAG.get(tag) if isinstance(tag, str) else None
        if base is None or ("name" in row and row["name"] != base.official_label):
            raise SECImportError("Unknown SEC concept or unverified label")
        unit = row.get("unit", base.unit)
        if (not isinstance(unit, str) or
                (base.data_type == "xbrli:monetaryItemType" and not re.fullmatch(r"[A-Z]{3}", unit)) or
                (base.data_type == "xbrli:sharesItemType" and unit != "shares") or
                (base.data_type == "dtr-types:perShareItemType" and not re.fullmatch(r"[A-Z]{3}/shares", unit))):
            raise SECImportError("Selected SEC unit conflicts with the official financial type")
        for key, expected in (("period_type", "instant" if base.instant else "duration"),
                              ("data_type", base.data_type), ("metadata_source", base.metadata_source)):
            if key in row and row[key] != expected:
                raise SECImportError("Selected SEC metadata conflicts with the official taxonomy")
        concepts.append(Concept(base.tag, base.name, base.instant, base.taxonomy, unit,
                                base.official_label, base.data_type, base.metadata_source))
    validate_concepts(tuple(concepts))
    return tuple(concepts)


def validate_concepts(concepts: tuple[Concept, ...]) -> None:
    if not concepts or len(concepts) > 20000:
        raise SECImportError("Select a bounded, nonempty SEC concept set")
    seen = set()
    for concept in concepts:
        if (not isinstance(concept, Concept) or not isinstance(concept.instant, bool)
                or not isinstance(concept.name, str) or not concept.name.strip()
                or not concept.name.isprintable() or len(concept.name) > 1000):
            raise SECImportError("Invalid SEC concept definition")
        frame_url(concept, 2009)
        official = _BY_TAG.get(concept.tag) if concept.taxonomy == "us-gaap" else None
        if official is None or concept.instant != official.instant:
            raise SECImportError("Unknown SEC concept or reporting type outside the validated catalog")
        if (official.data_type == "xbrli:monetaryItemType" and not re.fullmatch(r"[A-Z]{3}", concept.unit)
                or official.data_type == "xbrli:sharesItemType" and concept.unit != "shares"
                or official.data_type == "dtr-types:perShareItemType" and not re.fullmatch(r"[A-Z]{3}/shares", concept.unit)):
            raise SECImportError("Selected SEC unit conflicts with the official financial type")
        key = concept.taxonomy, concept.tag, concept.unit
        if key in seen:
            raise SECImportError("Duplicate SEC concept and unit selection")
        seen.add(key)


def catalog_sha256(concepts: tuple[Concept, ...]) -> str:
    identities = [[c.taxonomy, c.tag, c.unit, c.instant, c.official_label,
                   c.data_type, c.metadata_source] for c in concepts]
    return hashlib.sha256(json.dumps(identities, separators=(",", ":")).encode()).hexdigest()


def frame_name(concept: Concept, year: int) -> str:
    return f"CY{year}Q4I" if concept.instant else f"CY{year}"


def frame_url(concept: Concept, year: int) -> str:
    if (concept.taxonomy not in ("us-gaap", "ifrs-full")
            or not isinstance(concept.tag, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,300}", concept.tag)
            or not isinstance(concept.unit, str) or not re.fullmatch(r"(?:[A-Z]{3}(?:/shares)?|shares|pure)", concept.unit)):
        raise SECImportError("Unsupported SEC taxonomy, concept or unit")
    if isinstance(year, bool) or not isinstance(year, int) or not 2009 <= year < date.today().year:
        raise SECImportError("SEC frames require a historical year from 2009 onward")
    unit_path = concept.unit.replace("/", "-per-")
    return f"https://data.sec.gov/api/xbrl/frames/{concept.taxonomy}/{concept.tag}/{unit_path}/{frame_name(concept, year)}.json"


def filing_url(cik: str, accession: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"


def parse_frame(payload: Any, concept: Concept, year: int) -> tuple[list[dict], int]:
    """Validate one source frame; preserve its exact reporting-date identities."""
    expected = {"taxonomy": concept.taxonomy, "tag": concept.tag,
                "uom": concept.unit, "ccp": frame_name(concept, year)}
    if not isinstance(payload, dict) or any(payload.get(key) != value for key, value in expected.items()):
        raise SECImportError("SEC frame identity or unit did not match the request")
    rows = payload.get("data")
    count = payload.get("pts")
    if (not isinstance(rows, list) or len(rows) > MAX_FRAME_FACTS or isinstance(count, bool)
            or not isinstance(count, int) or count != len(rows)):
        raise SECImportError("SEC frame fact count is invalid or incomplete")
    facts, seen, skipped = [], {}, 0
    for row in rows:
        if not isinstance(row, dict):
            raise SECImportError("SEC frame contains an invalid fact")
        value = row.get("val")
        try:
            finite = isinstance(value, (int, float, Decimal)) and not isinstance(value, bool) and math.isfinite(value)
        except (OverflowError, ValueError):
            finite = False
        if not finite:
            skipped += 1
            continue
        cik, name, accession = row.get("cik"), row.get("entityName"), row.get("accn")
        if (isinstance(cik, bool) or not isinstance(cik, int) or not 1 <= cik <= 9999999999
                or not isinstance(name, str) or not name.strip() or len(name) > 500
                or not isinstance(accession, str) or not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession)):
            raise SECImportError("SEC frame contains an invalid issuer or filing identity")
        end, start = row.get("end"), row.get("start")
        try:
            if not isinstance(end, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
                raise ValueError("Invalid end")
            end_date = date.fromisoformat(end)
            if concept.instant:
                if start is not None:
                    raise ValueError("Instant fact has a duration")
            else:
                if not isinstance(start, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
                    raise ValueError("Invalid start")
                days = (end_date - date.fromisoformat(start)).days + 1
                if days <= 0:
                    raise ValueError("Reversed reporting interval")
        except ValueError as error:
            raise SECImportError("SEC frame contains an invalid reporting period") from error
        cik = str(cik).zfill(10)
        metadata = {"end": end, "accn": accession, "taxonomy": concept.taxonomy,
                    "concept": concept.tag, "unit": concept.unit, "frame": expected["ccp"],
                    "frame_url": frame_url(concept, year), "source_value": str(value)}
        if not concept.instant:
            metadata["start"] = start
            metadata["duration_days"] = days
            if not 335 <= days <= 395:
                # Actual frames can include changed/short fiscal years despite
                # the nominal annual-frame duration described in SEC docs.
                metadata["duration_outside_nominal_annual_range"] = True
        if isinstance(row.get("loc"), str):
            metadata["reported_location"] = row["loc"][:100]
        fact = {"entity_id": cik, "entity_name": name.strip(),
                "observation": {"period": end if concept.instant else start + "/" + end,
                                "value": float(value) if isinstance(value, Decimal) else value, "metadata": metadata,
                                "source_url": filing_url(cik, accession)}}
        if cik in seen:
            if seen[cik] != fact:
                raise SECImportError("SEC frame contains conflicting duplicate issuer facts")
            skipped += 1
            continue
        seen[cik] = fact
        facts.append(fact)
    return facts, skipped


class FrameClient:
    """Fixed-host, capped SEC downloads, at most two requests per second."""

    def __init__(self, scratch_dir: Path, max_requests: int, user_agent: str = DEFAULT_USER_AGENT):
        if isinstance(max_requests, bool) or not isinstance(max_requests, int) or not 1 <= max_requests <= MAX_REQUESTS:
            raise SECImportError(f"SEC request budget must be between 1 and {MAX_REQUESTS}")
        if (not isinstance(user_agent, str) or not user_agent.strip() or len(user_agent) > 300
                or any(ord(char) < 32 or ord(char) > 126 for char in user_agent)):
            raise SECImportError("Provide a printable SEC user agent")
        self.scratch_dir = Path(scratch_dir)
        if self.scratch_dir.is_symlink():
            raise SECImportError("SEC scratch directory must not be a symlink")
        self.scratch_dir.mkdir(parents=True, exist_ok=True)
        self.max_requests = max_requests
        self.request_count = 0
        self.user_agent = user_agent
        self.session = requests.Session()
        self._last_started = None

    def close(self):
        self.session.close()

    def fetch(self, url: str) -> Any:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.netloc != "data.sec.gov" or parsed.query or parsed.fragment
                or not re.fullmatch(r"/api/xbrl/frames/(?:us-gaap|ifrs-full)/[A-Za-z][A-Za-z0-9]{0,300}/(?:[A-Z]{3}(?:-per-shares)?|shares|pure)/CY\d{4}(?:Q[1-4]I)?\.json", parsed.path)):
            raise SECImportError("Unsupported SEC frame address")
        if self.request_count >= self.max_requests:
            raise SECImportError("SEC request budget exhausted")
        if self._last_started is not None:
            time.sleep(max(0, self._last_started + .5 - time.monotonic()))
        self._last_started = time.monotonic()
        self.request_count += 1
        try:
            with self.session.get(url, headers={"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"},
                                  timeout=(5, 25), allow_redirects=False, stream=True) as response:
                if response.status_code == 404:
                    return None  # No published facts for this concept/frame; never insert zero.
                if response.status_code != 200:
                    raise SECImportError(f"SEC frame request failed with HTTP {response.status_code}")
                length = response.headers.get("Content-Length", "")
                if length.isdigit() and int(length) > MAX_RESPONSE_BYTES:
                    raise SECImportError("SEC frame exceeds the download size limit")
                size, started = 0, time.monotonic()
                with tempfile.TemporaryFile(mode="w+b", dir=self.scratch_dir, prefix="sec-frame-", suffix=".tmp") as stream:
                    for chunk in response.iter_content(65536):
                        size += len(chunk)
                        if size > MAX_RESPONSE_BYTES or time.monotonic() - started > 45:
                            raise SECImportError("SEC frame exceeds the download size or time limit")
                        stream.write(chunk)
                    stream.seek(0)
                    return json.load(stream, parse_float=Decimal)
        except requests.RequestException as error:
            raise SECImportError("SEC frame connection failed; existing library data is preserved") from error
        except (ValueError, UnicodeError) as error:
            if isinstance(error, SECImportError):
                raise
            raise SECImportError("SEC frame is not valid JSON") from error


def plan_import(start_year: int = 2009, end_year: int | None = None, max_requests: int = 500,
                concepts: tuple[Concept, ...] = CONCEPTS, frame_offset: int = 0,
                frame_limit: int | None = None) -> dict:
    """Deterministic year-major scope; resume only with the same catalog hash."""
    end_year = date.today().year - 1 if end_year is None else end_year
    if (isinstance(start_year, bool) or isinstance(end_year, bool)
            or not isinstance(start_year, int) or not isinstance(end_year, int)
            or not 2009 <= start_year <= end_year < date.today().year or end_year - start_year >= 30):
        raise SECImportError("Select at most 30 historical SEC frame years from 2009 onward")
    if isinstance(max_requests, bool) or not isinstance(max_requests, int) or not 1 <= max_requests <= MAX_REQUESTS:
        raise SECImportError(f"SEC request budget must be between 1 and {MAX_REQUESTS}")
    validate_concepts(concepts)
    total = (end_year - start_year + 1) * len(concepts)
    if (isinstance(frame_offset, bool) or not isinstance(frame_offset, int)
            or not 0 <= frame_offset < total):
        raise SECImportError("SEC frame offset is outside the selected catalog and year range")
    if frame_limit is None:
        frame_limit = total - frame_offset
    if isinstance(frame_limit, bool) or not isinstance(frame_limit, int) or frame_limit < 1:
        raise SECImportError("SEC frame limit must be a positive integer")
    requested = min(frame_limit, total - frame_offset)
    if requested > max_requests:
        raise SECImportError(f"Requested SEC batch needs {requested} requests; select a smaller explicit frame limit or increase its explicit budget")
    frames = []
    for offset in range(frame_offset, frame_offset + requested):
        year, index = start_year + offset // len(concepts), offset % len(concepts)
        concept = concepts[index]
        frames.append({"offset": offset, "taxonomy": concept.taxonomy, "concept": concept.tag,
                       "unit": concept.unit, "year": year, "frame": frame_name(concept, year),
                       "url": frame_url(concept, year)})
    next_offset = frame_offset + requested
    return {"authorized_uses_notice": CATALOG["authorized_uses_notice"], "taxonomy_terms_url": CATALOG["terms_url"],
            "catalog_sha256": catalog_sha256(concepts), "catalog_id": CATALOG["id"],
            "catalog_metadata_sources": CATALOG["sources"],
            "selected_concept_count": len(concepts), "available_catalog_concept_count": len(ALL_CONCEPTS),
            "start_year": start_year, "end_year": end_year, "frame_offset": frame_offset,
            "frame_limit": requested, "total_requested_frames": total,
            "next_frame_offset": next_offset if next_offset < total else None,
            "selected_scope_end_reached": next_offset == total,
            "frames": frames, "scope": "Explicit selected concepts and units; calendar-aligned annual frames and Q4 instant snapshots. Actual company reporting dates are retained. Catalog universe: " + CATALOG["scope"]}


def _record_batch(conn, plan: dict, stamp: str, frame_count: int, empty_frames: list,
                  skipped: int, observation_count: int) -> None:
    # Kept in the same transaction as facts and dataset counts. This record is
    # import coverage evidence; it does not imply complete filing/entity coverage.
    conn.execute("""CREATE TABLE IF NOT EXISTS sec_frame_batches (
        id INTEGER PRIMARY KEY, committed_at TEXT NOT NULL, catalog_sha256 TEXT NOT NULL,
        start_year INTEGER NOT NULL, end_year INTEGER NOT NULL,
        frame_offset INTEGER NOT NULL, frame_limit INTEGER NOT NULL,
        frames_loaded INTEGER NOT NULL, observations_processed INTEGER NOT NULL,
        manifest TEXT NOT NULL)""")
    manifest = {**plan, "frames_loaded": frame_count, "unavailable_frames": empty_frames,
                "skipped_facts": skipped, "batch_observations": observation_count}
    conn.execute("INSERT INTO sec_frame_batches (committed_at,catalog_sha256,start_year,end_year,"
                 "frame_offset,frame_limit,frames_loaded,observations_processed,manifest) VALUES (?,?,?,?,?,?,?,?,?)",
                 (stamp, plan["catalog_sha256"], plan["start_year"], plan["end_year"],
                  plan["frame_offset"], plan["frame_limit"], frame_count, observation_count,
                  json.dumps(manifest, separators=(",", ":"))))


def _batch_coverage(conn, plan: dict) -> dict:
    ranges = conn.execute("SELECT frame_offset,frame_limit FROM sec_frame_batches WHERE "
                          "catalog_sha256=? AND start_year=? AND end_year=? ORDER BY frame_offset",
                          (plan["catalog_sha256"], plan["start_year"], plan["end_year"])).fetchall()
    covered, left, right = 0, 0, 0
    for offset, length in ranges:
        if offset > right:
            covered += right - left
            left = offset
        right = max(right, offset + length)
    covered += right - left
    return {"committed_unique_frames": covered,
            "selected_frame_scan_complete": covered == plan["total_requested_frames"]}


def import_library(database: Path, scratch_dir: Path, start_year: int = 2009,
                   end_year: int | None = None, max_requests: int = 100,
                   user_agent: str = DEFAULT_USER_AGENT, concepts: tuple[Concept, ...] = CONCEPTS,
                   frame_offset: int = 0, frame_limit: int | None = None,
                   expected_catalog_sha256: str | None = None) -> dict:
    """Commit a complete requested batch, or roll it back on a source failure."""
    from scripts.public_data_store import LibraryWriter, series_id

    plan = plan_import(start_year, end_year, max_requests, concepts, frame_offset, frame_limit)
    if expected_catalog_sha256 is not None and expected_catalog_sha256 != plan["catalog_sha256"]:
        raise SECImportError("SEC resume catalog hash changed; no source or database was opened")
    client = FrameClient(scratch_dir, max_requests, user_agent)
    frame_count, empty_frames, skipped, observation_count, entities = 0, [], 0, 0, set()
    try:
        writer = LibraryWriter(database, source="sec", dataset="frames")
        try:
            with writer:
                for requested_frame in plan["frames"]:
                    year = requested_frame["year"]
                    concept = concepts[requested_frame["offset"] % len(concepts)]
                    url = requested_frame["url"]
                    payload = client.fetch(url)
                    if payload is None:
                        empty_frames.append({"taxonomy": concept.taxonomy, "concept": concept.tag,
                                             "unit": concept.unit, "frame": frame_name(concept, year)})
                        continue
                    facts, ignored = parse_frame(payload, concept, year)
                    frame_count += 1
                    skipped += ignored
                    for fact in facts:
                        cik = fact["entity_id"]
                        indicator = concept.taxonomy + ":" + concept.tag
                        definition = {"id": series_id("sec", cik, indicator, concept.unit),
                                      "source": "sec", "dataset": "frames", "entity_id": cik,
                                      "entity_name": fact["entity_name"], "entity_type": "company",
                                      "indicator_id": indicator, "indicator_name": concept.name,
                                      "unit": concept.unit, "frequency": "annual", "source_url": url,
                                      "attribution": "U.S. Securities and Exchange Commission, EDGAR XBRL Frames; company-reported financial facts.",
                                      "license": "Public SEC EDGAR filings; issuer content may carry third-party rights. Taxonomy metadata: FASB Authorized Uses, " + CATALOG["terms_url"],
                                      "metadata": {"taxonomy": concept.taxonomy, "concept": concept.tag,
                                                   "authorized_uses_notice": CATALOG["authorized_uses_notice"],
                                                   "taxonomy_terms_url": CATALOG["terms_url"],
                                                   "taxonomy_terms_sha256": CATALOG["terms_sha256"],
                                                   "taxonomy_copyright_notice": CATALOG["copyright_notice"],
                                                   "fact_type": "instant" if concept.instant else "duration",
                                                   "official_label": concept.official_label or concept.name,
                                                   "financial_type": concept.data_type,
                                                   "catalog_metadata_source": CATALOG["sources"].get(concept.metadata_source, {}),
                                                   "source_label": payload.get("label", ""),
                                                   "source_description": payload.get("description", ""),
                                                   "frame_basis": "Calendar-aligned SEC selection; actual company reporting dates are retained.",
                                                   "documentation_url": DOCUMENTATION_URL}}
                        writer.add_series(definition, [fact["observation"]])
                        entities.add(cik)
                        observation_count += 1
                if not observation_count:
                    if frame_count == 0:
                        raise _NoPublishedFrames("No SEC frames were published for this exact batch")
                    raise SECImportError("No finite SEC observations were returned; existing library data is preserved")
                _record_batch(writer.conn, plan, writer.stamp, frame_count, empty_frames, skipped, observation_count)
                coverage = _batch_coverage(writer.conn, plan)
            summary = writer.summary()
        except _NoPublishedFrames:
            # LibraryWriter rolled back its empty fact transaction. Record only
            # the observed gaps, leaving all saved counts and refresh dates intact.
            with closing(sqlite3.connect(database, timeout=60)) as conn, conn:
                conn.execute("BEGIN IMMEDIATE")
                _record_batch(conn, plan, writer.stamp, 0, empty_frames, skipped, 0)
                coverage = _batch_coverage(conn, plan)
                counts = conn.execute("SELECT checked_at,series_count,entity_count,indicator_count,observation_count "
                                      "FROM datasets WHERE source='sec' AND dataset='frames'").fetchone()
            summary = dict(zip(("checked_at", "series_count", "entity_count", "indicator_count", "observation_count"),
                               counts or (None, 0, 0, 0, 0)), source="sec", dataset="frames", observations_processed=0)
    finally:
        client.close()
    return {"authorized_uses_notice": CATALOG["authorized_uses_notice"],
            **summary, **coverage, **{key: value for key, value in plan.items() if key != "frames"},
            "requests_made": client.request_count, "frames_loaded": frame_count,
            "unavailable_frames": empty_frames, "skipped_facts": skipped,
            "batch_entities": len(entities), "batch_observations": observation_count,
            "taxonomies": sorted({concept.taxonomy for concept in concepts}),
            "units": sorted({concept.unit for concept in concepts})}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path)
    parser.add_argument("--scratch-dir", type=Path)
    parser.add_argument("--start-year", type=int, default=2009)
    parser.add_argument("--end-year", type=int, default=date.today().year - 1)
    parser.add_argument("--max-requests", type=int, default=500)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--concept-catalog", type=Path, help="Explicit selection JSON, validated against official financial metadata")
    selection.add_argument("--all-catalog", action="store_true", help="Select every known monetary, shares and per-share concept; requires explicit bounded batches")
    selection.add_argument("--legacy-concepts", action="store_true", help="Select the original eight financial concepts and USD units")
    parser.add_argument("--frame-offset", type=int, default=0)
    parser.add_argument("--frame-limit", type=int, help="Import this many year-major concept frames, at most 500 per run")
    parser.add_argument("--expected-catalog-sha256", help="Require the unchanged catalog identity when resuming")
    parser.add_argument("--plan", action="store_true", help="Print exact requested frames and catalog provenance without database/network access")
    parser.add_argument("--user-agent", default=os.getenv("SEC_USER_AGENT") or DEFAULT_USER_AGENT)
    args = parser.parse_args(argv)
    try:
        concepts = (load_concepts(args.concept_catalog) if args.concept_catalog else
                    ALL_CONCEPTS if args.all_catalog else LEGACY_CONCEPTS if args.legacy_concepts else CONCEPTS)
        if args.plan:
            result = plan_import(args.start_year, args.end_year, args.max_requests,
                                 concepts, args.frame_offset, args.frame_limit)
            if args.expected_catalog_sha256 and args.expected_catalog_sha256 != result["catalog_sha256"]:
                raise SECImportError("SEC resume catalog hash changed")
        else:
            if args.database is None or args.scratch_dir is None:
                raise SECImportError("Provide --database and --scratch-dir for a SEC import")
            result = import_library(args.database, args.scratch_dir, args.start_year, args.end_year,
                                    args.max_requests, args.user_agent, concepts, args.frame_offset,
                                    args.frame_limit, args.expected_catalog_sha256)
    except (ValueError, OSError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
