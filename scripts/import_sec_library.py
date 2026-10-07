#!/usr/bin/env python3
"""Import bounded, public SEC XBRL frames into the maintained data library.

Annual frames are calendar-aligned selections, not aligned company fiscal years.
Actual reporting intervals, distinct XBRL concepts and currencies remain separate.
"""

import argparse
import json
import math
import os
import re
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import date
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


class SECImportError(ValueError):
    """A source response or requested scope cannot be imported safely."""


@dataclass(frozen=True)
class Concept:
    tag: str
    name: str
    instant: bool = False
    taxonomy: str = "us-gaap"
    unit: str = "USD"


# Revenue concepts are deliberately separate; their definitions are not synonyms.
CONCEPTS = (
    Concept("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenue from customer contracts, excluding assessed tax"),
    Concept("Revenues", "Revenues"),
    Concept("SalesRevenueNet", "Sales revenue, net"),
    Concept("Assets", "Total assets", instant=True),
    Concept("NetIncomeLoss", "Net income (loss)"),
    Concept("NetCashProvidedByUsedInOperatingActivities", "Net cash from operating activities"),
    Concept("StockholdersEquity", "Stockholders' equity", instant=True),
    Concept("CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", instant=True),
)


def frame_name(concept: Concept, year: int) -> str:
    return f"CY{year}Q4I" if concept.instant else f"CY{year}"


def frame_url(concept: Concept, year: int) -> str:
    for value in (concept.taxonomy, concept.tag, concept.unit):
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,100}", value):
            raise SECImportError("Unsupported SEC taxonomy, concept or unit")
    if isinstance(year, bool) or not isinstance(year, int) or not 2009 <= year < date.today().year:
        raise SECImportError("SEC frames require a historical year from 2009 onward")
    return f"https://data.sec.gov/api/xbrl/frames/{concept.taxonomy}/{concept.tag}/{concept.unit}/{frame_name(concept, year)}.json"


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
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
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
                    "frame_url": frame_url(concept, year)}
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
                                "value": value, "metadata": metadata,
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
                or not re.fullmatch(r"/api/xbrl/frames/(?:us-gaap|ifrs-full)/[A-Za-z][A-Za-z0-9]{0,100}/[A-Za-z][A-Za-z0-9-]{0,100}/CY\d{4}(?:Q[1-4]I)?\.json", parsed.path)):
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
                    return json.load(stream)
        except requests.RequestException as error:
            raise SECImportError("SEC frame connection failed; existing library data is preserved") from error
        except (ValueError, UnicodeError) as error:
            if isinstance(error, SECImportError):
                raise
            raise SECImportError("SEC frame is not valid JSON") from error


def import_library(database: Path, scratch_dir: Path, start_year: int = 2015,
                   end_year: int | None = None, max_requests: int = 100,
                   user_agent: str = DEFAULT_USER_AGENT, concepts: tuple[Concept, ...] = CONCEPTS) -> dict:
    """Commit a complete requested batch, or roll it back on a source failure."""
    from scripts.public_data_store import LibraryWriter, series_id

    end_year = date.today().year - 1 if end_year is None else end_year
    if (isinstance(start_year, bool) or isinstance(end_year, bool)
            or not isinstance(start_year, int) or not isinstance(end_year, int)
            or not 2009 <= start_year <= end_year < date.today().year or end_year - start_year >= 30):
        raise SECImportError("Select at most 30 historical SEC frame years from 2009 onward")
    requested = (end_year - start_year + 1) * len(concepts)
    if not concepts or requested > max_requests:
        raise SECImportError(f"Requested SEC batch needs {requested} requests; increase its explicit budget")
    client = FrameClient(scratch_dir, max_requests, user_agent)
    frame_count, empty_frames, skipped, observation_count, entities = 0, [], 0, 0, set()
    try:
        with LibraryWriter(database, source="sec", dataset="frames") as writer:
            for year in range(start_year, end_year + 1):
                for concept in concepts:
                    url = frame_url(concept, year)
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
                                      "license": "Public SEC EDGAR filings; issuer content may carry third-party rights.",
                                      "metadata": {"taxonomy": concept.taxonomy, "concept": concept.tag,
                                                   "fact_type": "instant" if concept.instant else "duration",
                                                   "frame_basis": "Calendar-aligned SEC selection; actual company reporting dates are retained.",
                                                   "documentation_url": DOCUMENTATION_URL}}
                        writer.add_series(definition, [fact["observation"]])
                        entities.add(cik)
                        observation_count += 1
            if not observation_count:
                raise SECImportError("No finite SEC observations were returned; existing library data is preserved")
        summary = writer.summary()
    finally:
        client.close()
    return {**summary, "requests_made": client.request_count, "frames_loaded": frame_count,
            "unavailable_frames": empty_frames, "skipped_facts": skipped,
            "batch_entities": len(entities), "batch_observations": observation_count,
            "start_year": start_year, "end_year": end_year,
            "taxonomies": sorted({concept.taxonomy for concept in concepts}),
            "units": sorted({concept.unit for concept in concepts}),
            "scope": "Selected SEC concepts and units; calendar-aligned frames, exact company reporting dates. Not every global company or currency."}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--scratch-dir", type=Path, required=True)
    parser.add_argument("--start-year", type=int, default=2015)
    parser.add_argument("--end-year", type=int, default=date.today().year - 1)
    parser.add_argument("--max-requests", type=int, default=100)
    parser.add_argument("--user-agent", default=os.getenv("SEC_USER_AGENT") or DEFAULT_USER_AGENT)
    args = parser.parse_args(argv)
    try:
        result = import_library(args.database, args.scratch_dir, args.start_year, args.end_year,
                                args.max_requests, args.user_agent)
    except (ValueError, OSError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
