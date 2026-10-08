"""SEC library contracts: exact periods, source identity, and atomic refreshes."""

import json
import hashlib
import sqlite3
from copy import deepcopy
from decimal import Decimal

import pytest

from scripts import import_sec_library as sec
from scripts import build_sec_concept_catalog as catalog_builder
from scripts.public_data_store import decode_metadata


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
                                 "duration_days": 366, "source_value": "120"}
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
                                     for i, value in enumerate([None, float("nan"), float("inf"), True, 10 ** 1000, -120])]), concept, 2024)
    assert skipped == 5
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


def test_catalog_has_verified_financial_types_labels_and_original_eight_identities():
    assert len(sec.CONCEPTS) == 98 and len(sec.ALL_CONCEPTS) == 7868
    assert [(c.taxonomy, c.tag, c.unit, c.instant) for c in sec.CONCEPTS[:8]] == [
        (c.taxonomy, c.tag, c.unit, c.instant) for c in sec.ORIGINAL_CONCEPTS]
    for concept in sec.ALL_CONCEPTS:
        assert concept.official_label == concept.name
        assert concept.metadata_source in sec.CATALOG["sources"]
        assert concept.data_type in {"xbrli:monetaryItemType", "xbrli:sharesItemType", "dtr-types:perShareItemType"}
    assert {c.unit for c in sec.CONCEPTS} == {"USD", "USD/shares", "shares"}
    assert "Deprecated" in next(c.name for c in sec.ALL_CONCEPTS if c.tag == "SalesRevenueNet")
    assert any(len(c.tag) > 101 for c in sec.ALL_CONCEPTS)  # Official long tags remain selectable.
    assert sec.CATALOG["authorized_uses_notice"].startswith("Notice: Authorized Uses")
    assert sec.CATALOG["terms_url"] == "https://xbrl.fasb.org/terms/TaxonomiesTermsConditions.html"
    notice = sec.CATALOG_PATH.with_name(sec.CATALOG["terms_notice_file"])
    assert hashlib.sha256(notice.read_bytes()).hexdigest() == sec.CATALOG["terms_sha256"]


def test_per_share_path_is_encoded_but_source_unit_and_precision_are_preserved(tmp_path, monkeypatch):
    concept = next(c for c in sec.CONCEPTS if c.tag == "EarningsPerShareDiluted")
    assert "/USD-per-shares/" in sec.frame_url(concept, 2024)
    payload = frame(concept, rows=[fact(value=Decimal("1.23000000000000000001"))])
    rows, _ = sec.parse_frame(payload, concept, 2024)
    point = rows[0]["observation"]
    assert point["value"] == 1.23
    assert point["metadata"]["unit"] == "USD/shares"
    assert point["metadata"]["source_value"] == "1.23000000000000000001"
    payload["uom"] = "USD-per-shares"
    with pytest.raises(sec.SECImportError, match="unit"):
        sec.parse_frame(payload, concept, 2024)
    client = sec.FrameClient(tmp_path, 1)
    monkeypatch.setattr(client.session, "get", lambda *a, **kw: Response(body=b'{"val":1.23000000000000000001}'))
    assert client.fetch(sec.frame_url(concept, 2024))["val"] == Decimal("1.23000000000000000001")
    client.close()


def test_share_count_and_large_source_integer_are_not_currencies_or_rounded_metadata():
    concept = next(c for c in sec.CONCEPTS if c.tag == "WeightedAverageNumberOfSharesOutstandingBasic")
    value = 9007199254740993
    rows, _ = sec.parse_frame(frame(concept, rows=[fact(value=value)]), concept, 2024)
    assert rows[0]["observation"]["metadata"]["unit"] == "shares"
    assert rows[0]["observation"]["metadata"]["source_value"] == str(value)


def test_configurable_selection_resolves_official_metadata_and_separate_currencies(tmp_path):
    path = tmp_path / "selection.json"
    path.write_text(json.dumps({"concepts": [{"tag": "Assets", "unit": "EUR"},
                                              {"tag": "EarningsPerShareDiluted", "unit": "EUR/shares"}]}))
    concepts = sec.load_concepts(path)
    assert [(c.unit, c.instant) for c in concepts] == [("EUR", True), ("EUR/shares", False)]
    assert all(c.official_label and c.data_type for c in concepts)
    assert sec.load_concepts(sec.CATALOG_PATH) == sec.ALL_CONCEPTS


@pytest.mark.parametrize("rows", [
    [{"tag": "InventedSECMetric"}], [{"tag": ["Assets"]}], [{"tag": "Assets", "name": "Unknown label"}],
    [{"tag": "Assets", "unit": "shares"}], [{"tag": "Assets", "period_type": "duration"}],
    [{"tag": "EarningsPerShareDiluted", "unit": "USD"}],
    [{"tag": "WeightedAverageNumberOfSharesOutstandingBasic", "unit": "USD"}],
    [{"tag": "Assets"}, {"tag": "Assets"}], [{"taxonomy": "ifrs-full", "tag": "Assets"}]])
def test_selection_rejects_unknown_aliases_types_units_and_duplicates(tmp_path, rows):
    path = tmp_path / "selection.json"
    path.write_text(json.dumps({"concepts": rows}))
    with pytest.raises(sec.SECImportError):
        sec.load_concepts(path)


def test_year_major_batches_include_all_historical_years_without_exceeding_budget():
    plan = sec.plan_import(2009, 2025, frame_limit=500)
    assert plan["total_requested_frames"] == 98 * 17
    assert plan["frame_limit"] == 500 and plan["next_frame_offset"] == 500
    assert plan["frames"][0]["year"] == 2009
    assert plan["frames"][98]["year"] == 2010
    final = sec.plan_import(2009, 2025, frame_offset=1500, frame_limit=500)
    assert final["frame_limit"] == 166 and final["next_frame_offset"] is None
    assert final["selected_scope_end_reached"] is True
    assert plan["catalog_sha256"] == final["catalog_sha256"]
    with pytest.raises(sec.SECImportError, match="budget"):
        sec.plan_import(2009, 2025)
    with pytest.raises(sec.SECImportError, match="budget"):
        sec.plan_import(2009, 2025, max_requests=501, frame_limit=501)


def test_resume_requires_same_catalog_before_any_network_or_database(tmp_path, monkeypatch):
    monkeypatch.setattr(sec.FrameClient, "__init__", lambda *a, **kw: pytest.fail("Client must not be opened"))
    with pytest.raises(sec.SECImportError, match="hash changed"):
        sec.import_library(tmp_path / "absent.sqlite3", tmp_path, 2024, 2024, frame_limit=1,
                           expected_catalog_sha256="0" * 64)
    assert not (tmp_path / "absent.sqlite3").exists()


def test_batch_checkpoint_is_atomic_additive_and_does_not_claim_skipped_offsets(tmp_path, monkeypatch):
    database = tmp_path / "library.sqlite3"
    concepts = (sec.CONCEPTS[0],)

    def fetch(client, url):
        year = int(url.rsplit("/", 1)[1][2:6])
        return frame(concepts[0], year, [fact(start=f"{year}-01-01", end=f"{year}-12-31")])

    monkeypatch.setattr(sec.FrameClient, "fetch", fetch)
    # Starting at the last offset is a completed batch, not completed coverage.
    result = sec.import_library(database, tmp_path, 2022, 2024, concepts=concepts, frame_offset=2, frame_limit=1)
    assert result["next_frame_offset"] is None
    assert result["committed_unique_frames"] == 1 and result["selected_frame_scan_complete"] is False
    result = sec.import_library(database, tmp_path, 2022, 2024, concepts=concepts, frame_limit=2)
    assert result["observation_count"] == 3 and result["selected_frame_scan_complete"] is True
    with sqlite3.connect(database) as conn:
        manifest = json.loads(conn.execute("SELECT manifest FROM sec_frame_batches ORDER BY id LIMIT 1").fetchone()[0])
        assert manifest["catalog_sha256"] == result["catalog_sha256"]
        assert manifest["frames"][0]["year"] == 2024
        assert conn.execute("SELECT COUNT(*) FROM sec_frame_batches").fetchone()[0] == 2
    result = sec.import_library(database, tmp_path, 2022, 2024, concepts=concepts, frame_limit=2)
    assert result["committed_unique_frames"] == 3  # Repeated ranges are counted once.
    calls = []

    def fail_later(client, url):
        calls.append(url)
        if len(calls) == 2:
            raise sec.SECImportError("provider down")
        return fetch(client, url)

    monkeypatch.setattr(sec.FrameClient, "fetch", fail_later)
    with pytest.raises(sec.SECImportError, match="provider down"):
        sec.import_library(database, tmp_path, 2022, 2024, concepts=concepts, frame_limit=2)
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sec_frame_batches").fetchone()[0] == 3
        assert conn.execute("SELECT observation_count FROM datasets").fetchone()[0] == 3


def test_all_unavailable_batch_records_gaps_without_refreshing_saved_facts_or_counts(tmp_path, monkeypatch):
    database = tmp_path / "library.sqlite3"
    concepts = (sec.CONCEPTS[0],)
    monkeypatch.setattr(sec.FrameClient, "fetch", lambda client, url: frame(concepts[0]))
    before = sec.import_library(database, tmp_path, 2024, 2024, concepts=concepts)
    monkeypatch.setattr(sec.FrameClient, "fetch", lambda client, url: None)
    after = sec.import_library(database, tmp_path, 2009, 2009, concepts=concepts)
    assert after["observation_count"] == before["observation_count"] == 1
    assert after["checked_at"] == before["checked_at"]
    assert after["batch_observations"] == 0 and after["frames_loaded"] == 0
    assert after["selected_frame_scan_complete"] is True
    assert after["unavailable_frames"][0]["frame"] == "CY2009"
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT COUNT(*) FROM sec_frame_batches").fetchone()[0] == 2


@pytest.mark.parametrize("checkpoint_fails", [False, True])
def test_all_unavailable_batch_closes_writer_and_checkpoint_connections(tmp_path, monkeypatch, checkpoint_fails):
    database = tmp_path / "library.sqlite3"
    concept = sec.CONCEPTS[0]
    monkeypatch.setattr(sec.FrameClient, "fetch", lambda client, url: frame(concept))
    sec.import_library(database, tmp_path, 2024, 2024, concepts=(concept,))
    monkeypatch.setattr(sec.FrameClient, "fetch", lambda client, url: None)
    opened = []
    real_connect = sqlite3.connect

    class TrackedConnection(sqlite3.Connection):
        closed = False

        def close(self):
            self.closed = True
            super().close()

    def tracked_connect(*args, **kwargs):
        conn = real_connect(*args, **kwargs, factory=TrackedConnection)
        opened.append(conn)
        return conn

    monkeypatch.setattr(sec.sqlite3, "connect", tracked_connect)
    if checkpoint_fails:
        def fail_checkpoint(*args, **kwargs):
            raise sec.SECImportError("checkpoint failed")

        monkeypatch.setattr(sec, "_record_batch", fail_checkpoint)
        with pytest.raises(sec.SECImportError, match="checkpoint failed"):
            sec.import_library(database, tmp_path, 2009, 2009, concepts=(concept,))
    else:
        sec.import_library(database, tmp_path, 2009, 2009, concepts=(concept,))
    assert len(opened) == 2
    assert all(conn.closed for conn in opened)
    for conn in opened:
        with pytest.raises(sqlite3.ProgrammingError, match="closed database"):
            conn.execute("SELECT 1")


def test_imported_series_preserves_complete_notice_and_taxonomy_provenance(tmp_path, monkeypatch):
    database = tmp_path / "library.sqlite3"
    concept = next(c for c in sec.CONCEPTS if c.tag == "EarningsPerShareDiluted")
    payload = frame(concept)
    payload["label"] = concept.official_label
    monkeypatch.setattr(sec.FrameClient, "fetch", lambda client, url: payload)
    sec.import_library(database, tmp_path, 2024, 2024, concepts=(concept,))
    with sqlite3.connect(database) as conn:
        metadata = decode_metadata(conn.execute("SELECT metadata FROM series").fetchone()[0])
    assert metadata["authorized_uses_notice"] == sec.CATALOG["authorized_uses_notice"]
    assert metadata["taxonomy_terms_sha256"] == sec.CATALOG["terms_sha256"]
    assert metadata["taxonomy_copyright_notice"] == sec.CATALOG["copyright_notice"]
    assert metadata["catalog_metadata_source"] == sec.CATALOG["sources"]["fasb2026"]


def test_plan_cli_requires_no_database_scratch_or_network(monkeypatch, capsys):
    monkeypatch.setattr(sec.FrameClient, "__init__", lambda *a, **kw: pytest.fail("No network in plan"))
    assert sec.main(["--plan", "--all-catalog", "--frame-limit", "1", "--start-year", "2009", "--end-year", "2025"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["selected_concept_count"] == 7868 and plan["total_requested_frames"] == 133756
    assert sec.main(["--plan", "--legacy-concepts", "--start-year", "2015", "--end-year", "2025"]) == 0
    legacy = json.loads(capsys.readouterr().out)
    assert legacy["selected_concept_count"] == 8 and legacy["total_requested_frames"] == 88


def test_official_catalog_builder_uses_label_arcs_financial_types_and_pinned_hashes(tmp_path, monkeypatch):
    schema = tmp_path / "schema.xml"
    schema.write_text('''<schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:i="http://www.xbrl.org/2003/instance">
      <element id="us-gaap_Assets" name="Assets" type="xbrli:monetaryItemType" i:periodType="instant"/>
      <element id="us-gaap_EarningsPerShareBasic" name="EarningsPerShareBasic" type="dtr-types:perShareItemType" i:periodType="duration"/>
      <element id="us-gaap_CommonStockSharesOutstanding" name="CommonStockSharesOutstanding" type="xbrli:sharesItemType" i:periodType="instant"/>
      <element id="us-gaap_Percentage" name="Percentage" type="dtr-types:percentItemType" i:periodType="duration"/>
      <element id="us-gaap_Abstract" name="Abstract" type="xbrli:monetaryItemType" abstract="true" i:periodType="instant"/>
    </schema>''')
    labels = tmp_path / "labels.xml"
    labels.write_text('''<linkbase xmlns="http://www.xbrl.org/2003/linkbase" xmlns:x="http://www.w3.org/1999/xlink"><labelLink>
      <loc x:label="a" x:href="schema.xml#us-gaap_Assets"/>
      <label x:label="al" x:role="http://www.xbrl.org/2003/role/label" xml:lang="en-US">Assets, Official Label</label>
      <labelArc x:from="a" x:to="al"/>
      <loc x:label="b" x:href="schema.xml#us-gaap_EarningsPerShareBasic"/>
      <label x:label="bl" x:role="http://www.xbrl.org/2003/role/label" xml:lang="en-US">Earnings Per Share, Basic</label>
      <labelArc x:from="b" x:to="bl"/>
      <loc x:label="c" x:href="schema.xml#us-gaap_CommonStockSharesOutstanding"/>
      <label x:label="cl" x:role="http://www.xbrl.org/2003/role/label" xml:lang="en-US">Common Stock Shares Outstanding</label>
      <labelArc x:from="c" x:to="cl"/>
    </labelLink></linkbase>''')
    baseline = {"sources": {"fasb2026": {"schema_sha256": hashlib.sha256(schema.read_bytes()).hexdigest(),
                                         "labels_sha256": hashlib.sha256(labels.read_bytes()).hexdigest()}},
                "core_tags": ["Assets"], "concepts": []}
    monkeypatch.setattr(sec, "CATALOG", baseline)
    result = catalog_builder.build_catalog(schema, labels)
    assert [(row["tag"], row["unit"], row["period_type"]) for row in result["concepts"]] == [
        ("Assets", "USD", "instant"), ("CommonStockSharesOutstanding", "shares", "instant"),
        ("EarningsPerShareBasic", "USD/shares", "duration")]
    assert result["concepts"][0]["name"] == "Assets, Official Label"
    labels.write_text("<different/>")
    with pytest.raises(sec.SECImportError, match="hash differs"):
        catalog_builder.build_catalog(schema, labels)
