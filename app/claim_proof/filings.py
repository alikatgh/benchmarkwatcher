"""Small, offline-verifiable extracts of SEC Companyfacts, not model-made facts.

SEC API documentation: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
The Companyfacts endpoint aggregates standard-taxonomy facts applying to the
entire filing entity. Its ``fy`` is the reporting filing's fiscal year, which
can differ from a comparative fact's year. This module matches actual duration
dates, USD units, annual 10-K records, and a common accession for four metrics.

Only selected original records are retained, with the retrieved payload's SHA256
and a checksum of the extract. The full-payload hash records acquisition provenance;
without the full payload it is not an independent authenticity proof. Runtime
checks reconcile every normalized operand to its retained original SEC record.
No network request occurs when the application loads these files.
"""

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .engine import CalculationError, Operand, ResearchEngine, exact, number, validate_operands


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "filing-proof"
MAX_BYTES = 16_000_000
MAX_EXTRACT_BYTES = 100_000
TIMEOUT_SECONDS = 20
DOWNLOAD_SECONDS = 30
USER_AGENT = "BenchmarkWatcher albert@wallmarkets.org"
YEARS = (2024, 2025)
DEFAULT_COMPANIES = ("MSFT", "AAPL", "GOOGL")
DEFAULT_MEASUREMENT_NOTE = "Calculated FCF is operating cash flow minus the retained cash PP&E payments; it is a standardized calculation, not a reported statement row."
COMPANIES = {
    "MSFT": {"cik": 789019, "company": "Microsoft Corporation", "fiscal_calendar": "june_30",
             "fiscal_calendar_label": "Annual fiscal years ending June 30"},
    "AAPL": {"cik": 320193, "company": "Apple Inc.", "fiscal_calendar": "september_last_saturday",
             "fiscal_calendar_label": "52/53-week fiscal years ending on September's last Saturday"},
    "GOOGL": {"cik": 1652044, "company": "Alphabet Inc.", "fiscal_calendar": "calendar_year",
              "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
    "AMZN": {"cik": 1018724, "company": "AMAZON COM INC", "fiscal_calendar": "calendar_year",
             "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31",
             "cash_ppe_tags": ("PaymentsToAcquireProductiveAssets",),
             "measurement_note": "Calculated FCF here is operating cash flow minus gross cash PP&E purchases. Amazon's reported free cash flow instead uses PP&E purchases net of proceeds and incentives; these measures differ."},
    "META": {"cik": 1326801, "company": "Meta Platforms, Inc.", "fiscal_calendar": "calendar_year",
             "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31",
             "measurement_note": "Calculated FCF here is operating cash flow minus cash PP&E purchases. Meta's reported free cash flow also subtracts finance-lease principal payments; these measures differ."},
    "TSLA": {"cik": 1318605, "company": "Tesla, Inc.", "fiscal_calendar": "calendar_year",
             "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31",
             "revenue_tags": ("Revenues",),
             "measurement_note": "Revenue uses total consolidated revenues, including leasing. Cash PP&E follows Tesla's statement row, excluding finance leases and net of sales. Calculated FCF is operating cash flow minus that retained cash PP&E measure."},
    "NFLX": {"cik": 1065280, "company": "Netflix, Inc.", "fiscal_calendar": "calendar_year",
             "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
    "AMD": {"cik": 2488, "company": "ADVANCED MICRO DEVICES INC", "fiscal_calendar": "december_last_saturday",
            "fiscal_calendar_label": "52/53-week fiscal years ending on December's last Saturday"},
    "NOW": {"cik": 1373715, "company": "SERVICENOW, INC.", "fiscal_calendar": "calendar_year",
            "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
    "PLTR": {"cik": 1321655, "company": "Palantir Technologies Inc.", "fiscal_calendar": "calendar_year",
             "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
    "AMGN": {"cik": 318154, "company": "Amgen Inc.", "fiscal_calendar": "calendar_year",
             "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
    "HON": {"cik": 773840, "company": "Honeywell International Inc", "fiscal_calendar": "calendar_year",
            "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
    "UNP": {"cik": 100885, "company": "UNION PACIFIC CORP", "fiscal_calendar": "calendar_year",
            "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
    "BKNG": {"cik": 1075531, "company": "Booking Holdings Inc.", "fiscal_calendar": "calendar_year",
             "fiscal_calendar_label": "Calendar fiscal years, January 1–December 31"},
}
TAGS = {
    "revenue": ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"),
    "operating_income": ("OperatingIncomeLoss",),
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities",),
    "cash_ppe_signed": ("PaymentsToAcquirePropertyPlantAndEquipment",),
}
ACCESSION = re.compile(r"[0-9]{10}-[0-9]{2}-[0-9]{6}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def select_companies(companies=None):
    """Resolve one to fourteen exact, distinct library IDs; omitted scope is legacy."""
    selected = DEFAULT_COMPANIES if companies is None else companies
    if (not isinstance(selected, (list, tuple)) or not 1 <= len(selected) <= 14
            or any(not isinstance(ticker, str) or ticker not in COMPANIES for ticker in selected)
            or len(set(selected)) != len(selected)):
        raise CalculationError("Choose one to fourteen distinct verified company IDs.")
    return tuple(selected)


def metric_tags(ticker, metric):
    """Total revenue semantics are explicit where another standard alias differs."""
    overrides = {"revenue": "revenue_tags", "cash_ppe_signed": "cash_ppe_tags"}
    return COMPANIES[ticker].get(overrides.get(metric), TAGS[metric])


def endpoint(ticker):
    if not isinstance(ticker, str) or ticker not in COMPANIES:
        raise CalculationError("Company is outside the SEC ingestion allowlist.")
    return f"https://data.sec.gov/api/xbrl/companyfacts/CIK{COMPANIES[ticker]['cik']:010d}.json"


def accession_url(ticker, accession):
    endpoint(ticker)
    if not isinstance(accession, str) or not ACCESSION.fullmatch(accession):
        raise CalculationError("Invalid SEC accession.")
    cik = COMPANIES[ticker]["cik"]
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/{accession}-index.html"


def records_hash(records):
    return hashlib.sha256(json.dumps(records, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _annual(ticker, year, start, end):
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except (TypeError, ValueError):
        return False
    if last.year != year or not 350 <= (last - first).days + 1 <= 380:
        return False
    calendar = COMPANIES.get(ticker, {}).get("fiscal_calendar")
    if calendar == "june_30":
        return start == f"{year - 1}-07-01" and end == f"{year}-06-30"
    if calendar == "calendar_year":
        return start == f"{year}-01-01" and end == f"{year}-12-31"
    if calendar == "december_last_saturday":
        # 52/53-week fiscal years ending on December's last Saturday.
        previous_december_end = date(year - 1, 12, 31)
        previous_year_end = previous_december_end - timedelta(days=(previous_december_end.weekday() - 5) % 7)
        return (last.month == 12 and last.weekday() == 5 and last.day >= 25
                and first == previous_year_end + timedelta(days=1))
    if calendar != "september_last_saturday":
        return False
    # Apple reports a 52/53-week fiscal year ending on September's last Saturday.
    previous_september_end = date(year - 1, 9, 30)
    previous_year_end = previous_september_end - timedelta(days=(previous_september_end.weekday() - 5) % 7)
    return (last.month == 9 and last.weekday() == 5 and last.day >= 24
            and first == previous_year_end + timedelta(days=1))


def _record_valid(ticker, year, entry):
    record = entry.get("record", {})
    if not isinstance(record, dict):
        raise CalculationError("A retained SEC source record must be an object.")
    if (entry.get("metric") not in TAGS or entry.get("taxonomy") != "us-gaap"
            or entry.get("tag") not in metric_tags(ticker, entry["metric"]) or entry.get("unit") != "USD"
            or not isinstance(entry.get("label"), str) or not entry["label"].strip()):
        raise CalculationError("Unsupported XBRL metric, taxonomy, or currency.")
    if record.get("form") != "10-K" or record.get("fp") != "FY":
        raise CalculationError("An annual 10-K fact is required.")
    if not _annual(ticker, year, record.get("start"), record.get("end")):
        raise CalculationError("Quarterly, mismatched, or ambiguous fiscal duration.")
    if type(record.get("fy")) is not int or not year <= record["fy"] <= 2100:
        raise CalculationError("Invalid reporting filing fiscal year.")
    accession_url(ticker, record.get("accn"))
    try:
        if date.fromisoformat(record["filed"]) < date.fromisoformat(record["end"]):
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise CalculationError("Invalid SEC filing date.") from None
    if type(record.get("val")) is not int:
        raise CalculationError("The retained SEC value must be an exact integer USD amount.")
    value = number(record["val"])
    if entry["metric"] in {"revenue", "cash_ppe_signed"} and value < 0:
        raise CalculationError("Unexpected negative reported revenue or PP&E payment.")
    return record


def build_extract(payload, ticker, *, raw_sha256, raw_bytes, fetched_at):
    """Select exactly two verified fiscal durations from an actual SEC response.

    Prefer one filing covering both years, then prefer the FY2025 filing over
    later comparatives. Missing or conflicting facts fail closed; there is no
    substitution of quarters, another currency, or a different XBRL meaning.
    """
    endpoint(ticker)
    if not isinstance(payload, dict):
        raise CalculationError("SEC Companyfacts response must be an object.")
    if payload.get("cik") != COMPANIES[ticker]["cik"] or payload.get("entityName") != COMPANIES[ticker]["company"]:
        raise CalculationError("SEC response company identity does not match the fixed CIK.")
    facts = payload.get("facts", {})
    concepts = facts.get("us-gaap", {}) if isinstance(facts, dict) else {}
    if not isinstance(concepts, dict):
        raise CalculationError("SEC Companyfacts taxonomy must be an object.")
    candidates = {}
    for year in YEARS:
        per_metric = {}
        for metric in TAGS:
            tags = metric_tags(ticker, metric)
            choices = {}
            for tag in tags:
                concept = concepts.get(tag, {})
                if not isinstance(concept, dict) or not isinstance(concept.get("units", {}), dict):
                    raise CalculationError("Invalid SEC concept units.")
                unit_records = concept.get("units", {}).get("USD", [])
                if not isinstance(unit_records, list):
                    raise CalculationError("Invalid SEC USD fact array.")
                for record in unit_records:
                    if not isinstance(record, dict):
                        raise CalculationError("Invalid SEC source record.")
                    if (record.get("form") != "10-K" or record.get("fp") != "FY"
                            or not _annual(ticker, year, record.get("start"), record.get("end"))):
                        continue
                    entry = {"period": f"FY{year}", "metric": metric, "taxonomy": "us-gaap", "tag": tag,
                             "label": concept.get("label", tag), "unit": "USD", "record": deepcopy(record)}
                    _record_valid(ticker, year, entry)
                    key = (record["start"], record["end"], record["accn"], record["filed"], record["fy"])
                    choices.setdefault(key, []).append(entry)
            if not choices:
                raise CalculationError(f"Missing annual USD fact: {ticker} FY{year} {metric}.")
            per_metric[metric] = choices
        common = set.intersection(*(set(choices) for choices in per_metric.values()))
        if not common:
            raise CalculationError(f"No common annual 10-K accession and duration for {ticker} FY{year}.")
        candidates[year] = {key: {metric: choices[key] for metric, choices in per_metric.items()} for key in common}
    shared_accessions = {key[2] for key in candidates[YEARS[0]]} & {key[2] for key in candidates[YEARS[1]]}
    selected = []
    if shared_accessions:
        # A filing's identity, date, and reporting year must agree across comparatives.
        common_filings = {(key[2], key[3], key[4]) for key in candidates[YEARS[0]]} & {
            (key[2], key[3], key[4]) for key in candidates[YEARS[1]]}
        if not common_filings:
            raise CalculationError("Conflicting filing metadata across comparative years.")
        filing = sorted(common_filings, key=lambda item: (item[2] == max(YEARS), item[1], item[0]), reverse=True)[0]
        available = {year: [key for key in candidates[year] if key[2:] == filing] for year in YEARS}
    else:
        available = {}
        for year in YEARS:
            keys = sorted(candidates[year], key=lambda key: (key[4] == year, key[3], key[2]), reverse=True)
            filing = keys[0][2:]
            available[year] = [key for key in keys if key[2:] == filing]
    for year in YEARS:
        if len(available[year]) != 1:
            raise CalculationError(f"Ambiguous annual fiscal duration for {ticker} FY{year}.")
        for metric, choices in candidates[year][available[year][0]].items():
            if len({entry["record"]["val"] for entry in choices}) != 1:
                raise CalculationError(f"Conflicting facts for {ticker} FY{year} {metric}.")
            # Equal aliases/duplicate frames are safe, but retain the preferred tag's actual original record.
            entry = sorted(choices, key=lambda item: (metric_tags(ticker, metric).index(item["tag"]), "frame" not in item["record"]))[0]
            selected.append(entry)
    result = {"schema_version": 1, "ticker": ticker, "cik": payload["cik"], "company": payload["entityName"],
              "source": {"kind": "sec_companyfacts", "endpoint": endpoint(ticker), "fetched_at": fetched_at,
                         "raw_sha256": raw_sha256, "raw_bytes": raw_bytes, "scope": "entire_filing_entity",
                         "records_sha256": records_hash(selected)}, "records": selected}
    _validate_extract(result)
    return result


def _validate_extract(extract):
    if not isinstance(extract, dict):
        raise CalculationError("SEC extract must be an object.")
    ticker = extract.get("ticker")
    endpoint(ticker)
    if (extract.get("schema_version") != 1 or extract.get("cik") != COMPANIES[ticker]["cik"]
            or extract.get("company") != COMPANIES[ticker]["company"]):
        raise CalculationError("Invalid filing extract identity or schema.")
    source, records = extract.get("source", {}), extract.get("records", [])
    if not isinstance(source, dict):
        raise CalculationError("SEC acquisition provenance must be an object.")
    if (source.get("kind") != "sec_companyfacts" or source.get("endpoint") != endpoint(ticker)
            or source.get("scope") != "entire_filing_entity"
            or not isinstance(source.get("raw_sha256"), str) or not SHA256.fullmatch(source["raw_sha256"])
            or type(source.get("raw_bytes")) is not int or not 0 < source["raw_bytes"] <= MAX_BYTES):
        raise CalculationError("Invalid SEC acquisition provenance.")
    try:
        retrieved = datetime.fromisoformat(source["fetched_at"])
        if retrieved.tzinfo is None or retrieved.utcoffset().total_seconds() != 0:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise CalculationError("SEC acquisition needs a UTC retrieval timestamp.") from None
    if not isinstance(records, list) or len(records) != len(YEARS) * len(TAGS):
        raise CalculationError("Missing or ambiguous retained source records.")
    if source.get("records_sha256") != records_hash(records):
        raise CalculationError("Retained SEC records checksum does not match.")
    grouped = {}
    for entry in records:
        if not isinstance(entry, dict) or entry.get("period") not in {f"FY{year}" for year in YEARS}:
            raise CalculationError("Unexpected retained fiscal period.")
        record = _record_valid(ticker, int(entry["period"][2:]), entry)
        if date.fromisoformat(record["filed"]) > retrieved.date():
            raise CalculationError("A source filing cannot postdate its SEC retrieval.")
        key = (entry["period"], entry["metric"])
        if key in grouped:
            raise CalculationError("Ambiguous duplicate retained source fact.")
        grouped[key] = record
    for year in YEARS:
        matched = [grouped.get((f"FY{year}", metric)) for metric in TAGS]
        if any(record is None for record in matched):
            raise CalculationError("Missing retained annual source fact.")
        signatures = {(record["start"], record["end"], record["accn"], record["filed"], record["fy"]) for record in matched}
        if len(signatures) != 1:
            raise CalculationError("Source facts mix fiscal durations or filing accessions.")


def _fixture(extract):
    source = extract["source"]
    company = COMPANIES[extract["ticker"]]
    fixture = {"prepared_on": source["fetched_at"][:10], "dataset": {
        "id": f"sec-{extract['ticker'].lower()}-fy2024-fy2025", "ticker": extract["ticker"],
        "company": extract["company"], "cik": extract["cik"], "periods": {},
        "fiscal_calendar": company["fiscal_calendar"], "fiscal_calendar_label": company["fiscal_calendar_label"],
        "measurement_note": company.get("measurement_note", DEFAULT_MEASUREMENT_NOTE),
        "provenance": {
            "kind": "sec_companyfacts", "description": "Retained annual entity-wide SEC XBRL facts; USD normalized to millions.",
            "source_url": source["endpoint"], "retrieved_on": source["fetched_at"][:10], "raw_sha256": source["raw_sha256"]}},
        "facts": {}, "sources": {}}
    for index, entry in enumerate(extract["records"]):
        period, metric, record = entry["period"], entry["metric"], entry["record"]
        source_id = "SEC_" + record["accn"].replace("-", "")
        fixture["dataset"]["periods"][period] = {"start": record["start"], "end": record["end"], "frequency": "annual"}
        value = Decimal(record["val"]) / Decimal(1_000_000)
        if metric == "cash_ppe_signed":
            value = -value
        fixture["facts"][f"{period}.{metric}"] = {"period": period, "value": exact(value), "unit": "USD_millions",
            "row": entry["label"], "source_id": source_id, "method": "reported", "taxonomy": "us-gaap",
            "xbrl_tag": entry["tag"], "source_record_index": index}
        document = fixture["sources"].setdefault(source_id, {"document": f"{extract['company']} Form 10-K",
            "section": "Consolidated financial statements (SEC XBRL)", "url": accession_url(extract["ticker"], record["accn"]),
            "accession": record["accn"], "filed": record["filed"], "columns": [], "rows": []})
        if period not in document["columns"]:
            document["columns"].append(period)
        if entry["label"] not in document["rows"]:
            document["rows"].append(entry["label"])
    fixture["dataset"]["periods"] = dict(sorted(fixture["dataset"]["periods"].items()))
    return fixture


class FilingEngine(ResearchEngine):
    """ResearchEngine-compatible facts with an independent SEC source boundary."""
    provenance = "sec_companyfacts"

    def __init__(self, extract):
        self._extract = deepcopy(extract)
        _validate_extract(self._extract)
        super().__init__(_fixture(self._extract))

    def execute(self, plan):
        # The legacy closed planner and presentation contain Microsoft-specific
        # assumptions. Multi-company calculations use the evidence workflow.
        raise CalculationError("SEC filing calculations require the multi-company evidence workflow.")

    def fact(self, period, metric):
        _validate_extract(self._extract)
        expected = _fixture(self._extract)
        key = f"{period}.{metric}"
        if period not in self.periods or metric not in TAGS or key not in expected["facts"]:
            raise CalculationError("Requested fact is outside the retained SEC dataset.")
        if (self.fixture.get("dataset") != expected["dataset"] or self.fixture.get("sources") != expected["sources"]
                or self.fixture.get("facts", {}).get(key) != expected["facts"][key]
                or self.periods != expected["dataset"]["periods"]):
            raise CalculationError("Normalized fact or source does not match its retained SEC record.")
        raw, dates = expected["facts"][key], self.periods[period]
        operand = Operand(key, number(raw["value"]), raw["unit"], dates["start"], dates["end"])
        validate_operands(operand)
        return operand

    def evidence(self, operand):
        if not isinstance(operand, Operand) or operand.id.count(".") != 1:
            raise CalculationError("Evidence requires a supported SEC operand.")
        period, metric = operand.id.split(".")
        if self.fact(period, metric) != operand:
            raise CalculationError("Operand differs from its retained SEC source.")
        raw = self.fixture["facts"][operand.id]
        source = self.fixture["sources"][raw["source_id"]]
        record = self._extract["records"][raw["source_record_index"]]["record"]
        provenance = self._extract["source"]
        return {"id": operand.id, "value": exact(operand.value), "unit": operand.unit,
            "normalized_usd": exact(operand.value * 1_000_000), "start": operand.start, "end": operand.end,
            "row": raw["row"], "source_id": raw["source_id"], "document": source["document"],
            "section": source["section"], "url": source["url"], "accession": source["accession"],
            "filed": source["filed"], "method": "reported", "taxonomy": raw["taxonomy"], "xbrl_tag": raw["xbrl_tag"],
            "reported_fy": record["fy"], "reported_value": str(record["val"]), "reported_unit": "USD",
            "normalization": "USD / 1000000; PP&E payments represented as a cash outflow" if metric == "cash_ppe_signed" else "USD / 1000000",
            "source_endpoint": provenance["endpoint"], "source_retrieved_at": provenance["fetched_at"],
            "source_sha256": provenance["raw_sha256"]}


def load_engines(directory=DATA_DIR, *, companies=DEFAULT_COMPANIES):
    """Load the legacy three by default, or an explicit verified library subset."""
    if (not isinstance(companies, (list, tuple)) or not companies
            or any(not isinstance(ticker, str) or ticker not in COMPANIES for ticker in companies)
            or len(set(companies)) != len(companies)):
        raise CalculationError("Choose distinct known filing companies.")
    engines = {}
    for ticker in companies:
        path = Path(directory) / f"{ticker.lower()}.json"
        if path.stat().st_size > MAX_EXTRACT_BYTES:
            raise CalculationError("SEC extract exceeds the bounded dataset size.")
        try:
            extract = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeError):
            raise CalculationError(f"Invalid SEC extract for {ticker}.") from None
        if extract.get("ticker") != ticker:
            raise CalculationError("SEC extract filename and company do not agree.")
        engines[ticker] = FilingEngine(extract)
    return engines


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CalculationError("SEC ingestion does not follow redirects.")


class SECClient:
    """At most three fixed-host requests, >=1s apart, no retries or credentials."""
    def __init__(self):
        self._seen = set()
        self._last_started = None
        self._opener = build_opener(_NoRedirect())

    def fetch(self, ticker, *, raw_path=None):
        url = endpoint(ticker)
        if ticker in self._seen or len(self._seen) >= 3:
            raise CalculationError("The SEC import allows one request per company and three companies per run.")
        if self._last_started is not None:
            time.sleep(max(0, 1 - (time.monotonic() - self._last_started)))
        self._seen.add(ticker)
        self._last_started = time.monotonic()
        deadline = self._last_started + DOWNLOAD_SECONDS
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", "Accept-Encoding": "identity"})
        try:
            with self._opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                if response.geturl() != url:
                    raise CalculationError("SEC response left the fixed endpoint.")
                chunks, size = [], 0
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise CalculationError("SEC response exceeded the total download deadline.")
                    if response.isclosed():
                        break
                    # urllib's standard HTTPS response wraps its live socket in
                    # fp.raw. Set the remaining overall budget before each single
                    # network read, so slow trickles cannot reset the deadline.
                    sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
                    if sock is None:
                        raise CalculationError("SEC response does not support a bounded socket read.")
                    sock.settimeout(min(TIMEOUT_SECONDS, remaining))
                    chunk = response.read1(min(65_536, MAX_BYTES + 1 - size))
                    if time.monotonic() >= deadline:
                        raise CalculationError("SEC response exceeded the total download deadline.")
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise CalculationError("SEC response exceeded the 16 MB limit.")
                    chunks.append(chunk)
                content = b"".join(chunks)
        except (OSError, URLError) as error:
            raise CalculationError(f"SEC request failed without retry: {type(error).__name__}.") from None
        if len(content) > MAX_BYTES:
            raise CalculationError("SEC response exceeded the 16 MB limit.")
        if raw_path is not None:
            # Explicit import-only staging preserves a bounded public response
            # for offline diagnosis; no re-fetch is needed after a selector fix.
            with Path(raw_path).open("xb") as output:
                output.write(content)
        try:
            payload = json.loads(content)
        except (ValueError, UnicodeError):
            raise CalculationError("SEC response is not valid JSON.") from None
        return build_extract(payload, ticker, raw_sha256=hashlib.sha256(content).hexdigest(), raw_bytes=len(content),
                             fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
