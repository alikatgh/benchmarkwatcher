"""SEC library contracts: exact periods, source identity, and atomic refreshes."""

import json
import sqlite3
from copy import deepcopy

import pytest

from scripts import import_sec_library as sec


def fact(cik=123, value=120, start="2024-01-01", end="2024-12-31", **extra):
    row = {"cik": cik, "entityName": "Example plc", "accn": "0000000123-25-000001",
           "loc": "GB:X0", "end": end, "val": value, **extra}
    if start is not None:
        row["start"] = start
    return row


def frame(concept=None, year=2024, rows=None):
    concept = concept or sec.CONCEPTS[0]
    rows = rows if rows is not None else [fact(start=None if concept.instant else "2024-01-01")]
    return {"taxonomy": concept.taxonomy, "tag": concept.tag, "uom": concept.unit,
            "ccp": sec.frame_name(concept, year), "pts": len(rows), "data": rows}


def test_exact_company_period_and_filing_provenance():
    concept = sec.CONCEPTS[0]
    rows, skipped = sec.parse_frame(frame(rows=[fact(start="2023-10-01", end="2024-09-30")]), concept, 2024)
    assert skipped == 0
    assert rows[0]["entity_id"] == "0000000123"
    point = rows[0]["observation"]
    assert point["period"] == "2023-10-01/2024-09-30"
    assert point["metadata"] == {"start": "2023-10-01", "end": "2024-09-30",
                                 "accn": "0000000123-25-000001", "taxonomy": "us-gaap",
                                 "concept": concept.tag, "unit": "USD", "frame": "CY2024",
                                 "frame_url": sec.frame_url(concept, 2024), "reported_location": "GB:X0",
                                 "duration_days": 366}
    assert point["source_url"] == "https://www.sec.gov/Archives/edgar/data/123/000000012325000001/0000000123-25-000001-index.htm"


def test_instant_preserves_actual_end_instead_of_calendar_year_end():
    concept = sec.Concept("Assets", "Assets", instant=True)
    rows, _ = sec.parse_frame(frame(concept, rows=[fact(start=None, end="2024-11-30")]), concept, 2024)
    assert rows[0]["observation"]["period"] == "2024-11-30"
    assert "start" not in rows[0]["observation"]["metadata"]
    assert rows[0]["observation"]["metadata"]["frame"] == "CY2024Q4I"


def test_short_or_changed_fiscal_year_is_preserved_and_flagged():
    rows, skipped = sec.parse_frame(frame(rows=[fact(start="2024-06-01")]), sec.CONCEPTS[0], 2024)
    assert skipped == 0
    point = rows[0]["observation"]
    assert point["period"] == "2024-06-01/2024-12-31"
    assert point["metadata"]["duration_days"] == 214
    assert point["metadata"]["duration_outside_nominal_annual_range"] is True


@pytest.mark.parametrize("field,value", [("taxonomy", "ifrs-full"), ("tag", "Revenues"),
                                          ("uom", "EUR"), ("ccp", "CY2023"), ("pts", 9)])
def test_rejects_wrong_source_identity_units_or_truncated_count(field, value):
    payload = frame()
    payload[field] = value
    with pytest.raises(sec.SECImportError):
        sec.parse_frame(payload, sec.CONCEPTS[0], 2024)


def test_units_are_explicit_and_never_converted():
    concept = sec.Concept("Revenues", "Revenues", unit="EUR")
    rows, _ = sec.parse_frame(frame(concept), concept, 2024)
    assert rows[0]["observation"]["metadata"]["unit"] == "EUR"
    assert rows[0]["observation"]["value"] == 120


def test_missing_nonfinite_and_bool_values_are_gaps_but_negative_values_survive():
    concept = sec.Concept("NetIncomeLoss", "Net income")
    rows, skipped = sec.parse_frame(frame(concept, rows=[fact(cik=i + 1, value=value)
                                     for i, value in enumerate([None, float("nan"), float("inf"), True, -120])]), concept, 2024)
    assert skipped == 4
    assert [item["observation"]["value"] for item in rows] == [-120]


def test_duplicate_rows_are_deduplicated_and_conflicting_rows_fail_closed():
    row = fact()
    rows, skipped = sec.parse_frame(frame(rows=[row, deepcopy(row)]), sec.CONCEPTS[0], 2024)
    assert len(rows) == 1 and skipped == 1
    with pytest.raises(sec.SECImportError, match="conflicting duplicate"):
        sec.parse_frame(frame(rows=[row, fact(value=121)]), sec.CONCEPTS[0], 2024)


@pytest.mark.parametrize("row", [fact(start="2025-01-01"), fact(end="2024-02-30"),
                                 fact(cik=True), fact(accn="../../filing")])
def test_rejects_malformed_fiscal_period_or_identity(row):
    with pytest.raises(sec.SECImportError):
        sec.parse_frame(frame(rows=[row]), sec.CONCEPTS[0], 2024)


class Response:
    def __init__(self, status=200, body=b"{}", headers=None):
        self.status_code, self.body, self.headers = status, body, headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def iter_content(self, size):
        for offset in range(0, len(self.body), size):
            yield self.body[offset:offset + size]


def test_client_rejects_redirects_and_excess_bytes_without_retaining_scratch(tmp_path, monkeypatch):
    client = sec.FrameClient(tmp_path, 2)
    url = sec.frame_url(sec.CONCEPTS[0], 2024)
    monkeypatch.setattr(client.session, "get", lambda *a, **kw: Response(status=302))
    with pytest.raises(sec.SECImportError, match="HTTP 302"):
        client.fetch(url)
    monkeypatch.setattr(sec, "MAX_RESPONSE_BYTES", 3)
    monkeypatch.setattr(client.session, "get", lambda *a, **kw: Response(body=b"12345"))
    with pytest.raises(sec.SECImportError, match="size"):
        client.fetch(url)
    assert list(tmp_path.iterdir()) == []
    client.close()


@pytest.mark.parametrize("url", ["http://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2024Q4I.json",
                                  "https://data.sec.gov.evil.test/api/xbrl/frames/us-gaap/Assets/USD/CY2024Q4I.json",
                                  "https://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2024Q4I.json?redirect=x",
                                  "https://data.sec.gov/submissions/CIK0000000123.json"])
def test_client_fixed_address_allowlist_precedes_any_request(tmp_path, monkeypatch, url):
    client = sec.FrameClient(tmp_path, 1)
    monkeypatch.setattr(client.session, "get", lambda *a, **kw: pytest.fail("Network must not be reached"))
    with pytest.raises(sec.SECImportError, match="address"):
        client.fetch(url)
    assert client.request_count == 0
    client.close()


def test_client_missing_frames_budget_and_two_request_per_second_pacing(tmp_path, monkeypatch):
    client = sec.FrameClient(tmp_path, 2)
    options, sleeps = [], []
    monkeypatch.setattr(sec.time, "monotonic", lambda: 100)
    monkeypatch.setattr(sec.time, "sleep", sleeps.append)

    def get(url, **kwargs):
        options.append(kwargs)
        return Response(status=404)

    monkeypatch.setattr(client.session, "get", get)
    url = sec.frame_url(sec.CONCEPTS[0], 2024)
    assert client.fetch(url) is None and client.fetch(url) is None
    assert sleeps == [.5]
    assert options[0]["allow_redirects"] is False and options[0]["stream"] is True
    assert options[0]["headers"]["User-Agent"] == sec.DEFAULT_USER_AGENT
    with pytest.raises(sec.SECImportError, match="budget"):
        client.fetch(url)
    client.close()


def test_real_store_keeps_concepts_currencies_dates_and_revisions_separate(tmp_path, monkeypatch):
    database = tmp_path / "library.sqlite3"
    concepts = (sec.Concept("Revenues", "Revenues"), sec.CONCEPTS[0],
                sec.Concept("Revenues", "Revenues", unit="EUR"))
    revision = [False]

    def fetch(client, url):
        concept = next(c for c in concepts if f"/{c.tag}/{c.unit}/" in url)
        year = int(url.rsplit("/", 1)[1][2:6])
        value = 125 if revision[0] else 120
        rows = [fact(value=value, start=f"{year - 1}-10-01", end=f"{year}-09-30")]
        return frame(concept, year, rows)

    monkeypatch.setattr(sec.FrameClient, "fetch", fetch)
    result = sec.import_library(database, tmp_path / "scratch", 2023, 2024, concepts=concepts)
    assert result["series_count"] == 3 and result["observation_count"] == 6
    assert result["entity_count"] == 1 and result["indicator_count"] == 2
    with sqlite3.connect(database) as conn:
        assert {row[0] for row in conn.execute("SELECT period FROM observations")} == {
            "2022-10-01/2023-09-30", "2023-10-01/2024-09-30"}
        assert {row[0] for row in conn.execute("SELECT unit FROM series")} == {"USD", "EUR"}
        metadata = json.loads(conn.execute("SELECT metadata FROM observations LIMIT 1").fetchone()[0])
        assert metadata["accn"] == "0000000123-25-000001" and metadata["end"] in {"2023-09-30", "2024-09-30"}
    revision[0] = True
    result = sec.import_library(database, tmp_path / "scratch", 2024, 2024, concepts=concepts)
    assert result["observation_count"] == 6  # Narrow refresh preserves older periods.
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT COUNT(*) FROM observation_revisions").fetchone()[0] == 3
        assert conn.execute("SELECT COUNT(*) FROM observations WHERE value=120").fetchone()[0] == 3


def test_failed_later_frame_rolls_back_entire_batch_and_keeps_prior_dataset(tmp_path, monkeypatch):
    database = tmp_path / "library.sqlite3"
    concept = sec.CONCEPTS[0]
    monkeypatch.setattr(sec.FrameClient, "fetch", lambda client, url: frame(concept))
    sec.import_library(database, tmp_path / "scratch", 2024, 2024, concepts=(concept,))
    calls = []

    def fetch(client, url):
        calls.append(url)
        if len(calls) == 2:
            raise sec.SECImportError("provider down")
        return frame(concept, 2023, [fact(value=999, start="2023-01-01", end="2023-12-31")])

    monkeypatch.setattr(sec.FrameClient, "fetch", fetch)
    with pytest.raises(sec.SECImportError, match="provider down"):
        sec.import_library(database, tmp_path / "scratch", 2023, 2024, concepts=(concept,))
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT period,value FROM observations").fetchall() == [("2024-01-01/2024-12-31", 120)]
        assert conn.execute("SELECT observation_count FROM datasets").fetchone()[0] == 1


def test_scope_requires_budget_before_network_or_database_creation(tmp_path, monkeypatch):
    monkeypatch.setattr(sec.FrameClient, "__init__", lambda *a, **kw: pytest.fail("Client must not be opened"))
    with pytest.raises(sec.SECImportError, match="budget"):
        sec.import_library(tmp_path / "absent.sqlite3", tmp_path / "scratch", 2015, 2024, max_requests=1)
    assert not (tmp_path / "absent.sqlite3").exists()
