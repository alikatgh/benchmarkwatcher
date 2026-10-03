"""No-network regression checks for official global reference ingestion."""

import json
from copy import deepcopy

import pytest

from scripts import global_sources
from scripts import fetch_daily_data as daily
from scripts.fetch_global_sources import main as fetch_main
from scripts.fetchers import global_reference as reader
from scripts.global_sources import (discover_worldbank, fetch_reference, load_registry,
                                    load_series, registry_summary, validate_registry)


def eurostat_payload():
    selections = {"freq": "M", "unit": "RCH_A", "coicop18": "TOTAL", "geo": "DE"}
    return {"class": "dataset", "id": [*selections, "time"], "size": [1, 1, 1, 1, 3],
            "dimension": {**{key: {"category": {"index": {value: 0}}} for key, value in selections.items()},
                          "time": {"category": {"index": {"2026-07": 0, "2026-08": 1, "2026-09": 2}}}},
            "value": {"0": 2.8, "2": 3.3}, "status": {"2": "e"}}, selections


class DataClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def get_json(self, url, params=None):
        self.calls.append((url, params))
        return self.payload

    def get_text(self, url, params=None):
        self.calls.append((url, params))
        return self.payload


def test_registry_separates_catalogue_from_readers_and_billing():
    registry = load_registry()
    summary = registry_summary(registry)
    assert summary["catalogued_sources"] >= 25
    assert summary["reader_implementations"] == 5
    assert summary["billing_enabled"] is False
    assert summary["by_status"]["needs_registration"] > 0
    assert {"Asia", "Africa", "Middle East", "Oceania", "South America"} <= set(summary["by_region"])
    assert all(source["access"]["billing_enabled"] is False for source in registry["sources"])


def test_ready_reader_cannot_be_marked_paid_or_key_required():
    registry = deepcopy(load_registry())
    registry["sources"][0]["access"]["authentication"] = "api_key"
    with pytest.raises(reader.SourceError, match="no-key"):
        validate_registry(registry)


def test_duplicate_source_rejected():
    registry = deepcopy(load_registry())
    registry["sources"].append(registry["sources"][0])
    with pytest.raises(reader.SourceError, match="Duplicate"):
        validate_registry(registry)


def test_curated_series_keep_types_units_and_geographies():
    series = load_series()
    types = {item["reference_type"] for item in series}
    assert {"commodity_index", "exchange_reference", "consumer_inflation", "economic_indicator", "retail_fuel_price"} <= types
    assert all(item["api_config"]["provider"] == item["source_id"] for item in series)
    assert all(item["source_type"] == "GLOBAL_REFERENCE" for item in series)
    assert all(item["date_semantics"] == "period_start" for item in series if item["frequency"] in {"monthly", "annual"})


def test_ecb_preserves_precision_gaps_and_units():
    csv = ("FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,OBS_STATUS,UNIT_MULT\n"
           "D,USD,EUR,2026-10-02,1.122512,A,0\n"
           "D,USD,EUR,2026-10-01,,M,0\n"
           "D,USD,EUR,2026-09-30,1.1355,A,0\n")
    points = reader.parse_ecb_csv(csv, "USD")
    assert [point["date"] for point in points] == ["2026-09-30", "2026-10-02"]
    assert points[-1]["price"] == 1.122512
    assert points[-1]["period"] == "2026-10-02"


@pytest.mark.parametrize("csv", [
    "FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,UNIT_MULT\nD,USD,GBP,2026-10-02,1.1,0\n",
    "FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,UNIT_MULT\nD,USD,EUR,2026-10-02,1.1,3\n",
    "date,value\n2026-10-02,1.1\n",
])
def test_ecb_rejects_changed_identity_units_or_schema(csv):
    with pytest.raises(reader.SourceError):
        reader.parse_ecb_csv(csv, "USD")


def test_canada_sorts_and_does_not_substitute_missing_values():
    payload = {"seriesDetail": {"M.BCPI": {}}, "observations": [
        {"d": "2026-09-01", "M.BCPI": {"v": "746.36"}},
        {"d": "2026-08-01", "M.BCPI": {}},
        {"d": "2026-07-01", "M.BCPI": {"v": "697.73"}},
        {"d": "not-a-date", "M.BCPI": {"v": "200"}},
    ]}
    result = reader.parse_valet_json(payload, "M.BCPI")
    assert [p["price"] for p in result] == [697.73, 746.36]


def test_canada_response_cannot_silently_switch_series():
    with pytest.raises(reader.SourceError):
        reader.parse_valet_json({"seriesDetail": {"OTHER": {}}, "observations": []}, "M.BCPI")


def test_eurostat_retains_original_month_missing_gap_and_estimate_flag():
    payload, selections = eurostat_payload()
    points = reader.parse_eurostat_json(payload, selections)
    assert points == [{"date": "2026-07-01", "period": "2026-07", "price": 2.8},
                      {"date": "2026-09-01", "period": "2026-09", "price": 3.3, "status": "e"}]


def test_eurostat_rejects_multiple_countries_instead_of_merging_them():
    payload, selections = eurostat_payload()
    payload["size"][3] = 2
    payload["dimension"]["geo"]["category"]["index"] = {"DE": 0, "FR": 1}
    with pytest.raises(reader.SourceError, match="multiple"):
        reader.parse_eurostat_json(payload, selections)


def test_eurostat_reader_uses_current_2026_dataset():
    payload, _ = eurostat_payload()
    client = DataClient(payload)
    reader.fetch_eurostat_hicp(client, "DE", 3)
    url, params = client.calls[0]
    assert url.endswith("/prc_hicp_minr")
    assert params["coicop18"] == "TOTAL"
    assert "coicop" not in params


@pytest.mark.parametrize("field,value", [("dimension", None), ("dimension", "invalid"), ("id", [None]), ("size", None)])
def test_eurostat_rejects_broken_metadata_shapes(field, value):
    payload, selections = eurostat_payload()
    payload[field] = value
    with pytest.raises(reader.SourceError):
        reader.parse_eurostat_json(payload, selections)


def test_worldbank_null_annual_values_remain_missing_not_zero():
    def row(year, value):
        return {"country": {"id": "IN"}, "indicator": {"id": "NV.AGR.TOTL.ZS"}, "date": year, "value": value}
    points = reader.parse_worldbank_json([{"pages": 1}, [row("2024", 16.3), row("2023", None), row("2022", 16.6)]], "IN", "NV.AGR.TOTL.ZS")
    assert [point["period"] for point in points] == ["2022", "2024"]
    assert points[-1]["date"] == "2024-01-01"


def test_worldbank_refuses_truncated_page():
    with pytest.raises(reader.SourceError, match="paginated"):
        reader.parse_worldbank_json([{"pages": 3}, []], "IN", "NV.AGR.TOTL.ZS")


@pytest.mark.parametrize("row", [None, "invalid", {"indicator": None, "country": {}}, {"indicator": {}, "country": "invalid"}])
def test_worldbank_rejects_broken_observation_shapes(row):
    with pytest.raises(reader.SourceError):
        reader.parse_worldbank_json([{"pages": 1}, [row]], "IN", "NV.AGR.TOTL.ZS")


def test_worldbank_refuses_current_or_future_year_range():
    from datetime import date
    with pytest.raises(reader.SourceError, match="historical"):
        reader.fetch_worldbank_indicator(DataClient(None), "IN", "NV.AGR.TOTL.ZS", end_year=date.today().year)


def test_fuel_parser_does_not_use_other_region_when_missing():
    text = "series_type,date,ron97,diesel,diesel_eastmsia\nlevel,2026-09-30,4.25,4.30,2.15\nlevel,2026-09-23,4.2,4.3,\n"
    points = reader.parse_malaysia_fuel_csv(text, "diesel_eastmsia")
    assert points == [{"date": "2026-09-30", "period": "2026-09-30", "price": 2.15}]


@pytest.mark.parametrize('reversed_order', [False, True])
def test_fuel_price_levels_are_not_overwritten_by_same_date_weekly_changes(reversed_order):
    rows = ["level,2026-10-01,5.0,2.15", "change_weekly,2026-10-01,-0.04999999999999982,0.0"]
    text = "series_type,date,ron97,diesel_eastmsia\n" + '\n'.join(reversed(rows) if reversed_order else rows) + '\n'
    assert reader.parse_malaysia_fuel_csv(text, "ron97")[-1]['price'] == 5.0
    assert reader.parse_malaysia_fuel_csv(text, "diesel_eastmsia")[-1]['price'] == 2.15
    with pytest.raises(reader.SourceError, match="columns"):
        reader.parse_malaysia_fuel_csv("date,ron97\n2026-10-01,5.0\n", "ron97")
    with pytest.raises(reader.SourceError, match="levels"):
        reader.fetch_malaysia_fuel(DataClient(text), series_type="change_weekly")


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", None, True, "."])
def test_nonfinite_or_missing_numbers_are_never_published(value):
    assert reader._number(value) is None


@pytest.mark.parametrize("url", [
    "http://api.worldbank.org/v2/country", "https://localhost/v2/country",
    "https://api.worldbank.org.evil.example/v2/country", "https://api.worldbank.org/anything",
    "https://user:password@api.worldbank.org/v2/country", "https://api.worldbank.org:8443/v2/country",
    "https://api.worldbank.org/v2/country?api_key=secret",
])
def test_transport_rejects_nonallowlisted_endpoints_without_network(url):
    client = reader.OfficialClient()
    try:
        with pytest.raises(reader.SourceError, match="allowlisted"):
            client.get_text(url)
        assert client.request_count == 0
    finally:
        client.close()


class FakeResponse:
    def __init__(self, body=b"{}", status=200, headers=None):
        self.body, self.status_code, self.headers = body, status, headers or {}
        self.closed = False

    def iter_content(self, chunk_size):
        yield self.body

    def raise_for_status(self):
        return None

    def close(self):
        self.closed = True


def test_transport_stream_cap_redirect_budget_and_no_retry(monkeypatch):
    client = reader.OfficialClient(max_requests=1)
    response = FakeResponse(b"123456789")
    calls = []
    def get(*args, **kwargs):
        calls.append(kwargs)
        return response
    monkeypatch.setattr(client.session, "get", get)
    monkeypatch.setattr(reader, "MAX_RESPONSE_BYTES", 8)
    try:
        with pytest.raises(reader.SourceError, match="body limit"):
            client.get_text("https://api.worldbank.org/v2/country")
        with pytest.raises(reader.SourceError, match="budget"):
            client.get_text("https://api.worldbank.org/v2/indicator")
        assert len(calls) == 1
        assert calls[0]["allow_redirects"] is False
        assert calls[0]["timeout"] == (5, 25)
        assert response.closed
    finally:
        client.close()


def test_transport_uses_command_cache_for_identical_published_csv(monkeypatch):
    client = reader.OfficialClient(max_requests=1)
    calls = []
    def get(*args, **kwargs):
        calls.append(args)
        return FakeResponse(b"date,ron97\n2026-09-30,4.25\n")
    monkeypatch.setattr(client.session, "get", get)
    try:
        url = "https://storage.data.gov.my/commodities/fuelprice.csv"
        assert client.get_text(url) == client.get_text(url)
        assert len(calls) == 1
    finally:
        client.close()


def test_worldbank_discovery_separates_economies_and_aggregates_and_no_fanout():
    class CatalogClient:
        calls = []
        def get_json(self, url, params):
            self.calls.append((url, params))
            if url.endswith("country"):
                return [{"pages": 1}, [{"id": "IND", "iso2Code": "IN", "name": "India", "region": {"id": "SAS", "value": "South Asia"}},
                                       {"id": "WLD", "iso2Code": "1W", "name": "World", "region": {"id": "NA", "value": "Aggregates"}}]]
            return [{"pages": 1, "total": 1}, [{"id": "TEST", "name": "Example", "sourceOrganization": "Official statistics", "topics": []}]]
    client = CatalogClient()
    result = discover_worldbank(client)
    assert result["economies_count"] == 1
    assert result["indicator_count"] == 1
    assert result["observation_series_connected"] == 0
    assert result["complete"] is True
    assert len(client.calls) == 2
    assert not any("/indicator/" in url for url, _ in client.calls)


def test_record_headline_matches_latest_source_and_keeps_type(monkeypatch):
    series = next(series for series in load_series() if series["id"] == "ecb_eur_usd")
    points = [{"date": "2026-10-01", "period": "2026-10-01", "price": 1.1298},
              {"date": "2026-10-02", "period": "2026-10-02", "price": 1.1225}]
    monkeypatch.setitem(global_sources.GLOBAL_FETCHERS, "ecb", lambda client, **kwargs: points)
    record = fetch_reference(series, DataClient(None))
    assert record["price"] == points[-1]["price"]
    assert record["reference_type"] == "exchange_reference"
    assert record["unit"] == "USD per EUR"
    assert record["source_class"] == "official_reference"


def test_daily_compatibility_hook_reuses_borrowed_client_without_closing_it(monkeypatch):
    class BatchClient:
        closed = False
        def close(self):
            self.closed = True
    client = BatchClient()
    seen = []
    def fetch(batch_client, currency):
        seen.append(batch_client)
        return [{"date": "2026-10-02", "price": 1.1, "period": "2026-10-02"}]
    monkeypatch.setitem(reader.GLOBAL_FETCHERS, "ecb", fetch)
    assert reader.fetch_global_reference("ecb", client=client, currency="USD")
    assert seen == [client]
    assert client.closed is False


def test_daily_compatibility_hook_closes_owned_client_after_failure(monkeypatch):
    class SingleClient:
        closed = False
        def close(self):
            self.closed = True
    client = SingleClient()
    monkeypatch.setattr(reader, "OfficialClient", lambda **kwargs: client)
    def unavailable(*args, **kwargs):
        raise reader.SourceError("Unavailable")
    monkeypatch.setitem(reader.GLOBAL_FETCHERS, "ecb", unavailable)
    assert reader.fetch_global_reference("ecb", currency="USD") is None
    assert client.closed is True


def test_failed_fetch_preserves_existing_record(tmp_path, monkeypatch, capsys):
    existing = tmp_path / "ecb_eur_usd.json"
    existing.write_text('{"price":1.0}\n')
    def unavailable(*args):
        raise reader.SourceError("Unavailable")
    monkeypatch.setattr("scripts.fetch_global_sources.fetch_reference", unavailable)
    assert fetch_main(["--series", "ecb_eur_usd", "--output-dir", str(tmp_path)]) == 1
    assert existing.read_text() == '{"price":1.0}\n'
    assert json.loads(capsys.readouterr().out)["results"][0]["status"] == "failed"


def test_fetch_cli_requires_explicit_series_and_destination():
    with pytest.raises(SystemExit):
        fetch_main([])


def test_fetch_cli_reports_write_failure_instead_of_fetched(tmp_path, monkeypatch, capsys):
    path = tmp_path / 'ecb_eur_usd.json'
    path.write_text('{"price":1.0}\n')
    monkeypatch.setattr('scripts.fetch_global_sources.fetch_reference', lambda *args: {'history': []})
    monkeypatch.setattr('scripts.fetch_global_sources.save_atomic', lambda *args: False)
    assert fetch_main(['--series', 'ecb_eur_usd', '--output-dir', str(tmp_path)]) == 1
    result = json.loads(capsys.readouterr().out)['results'][0]
    assert result['status'] == 'failed' and 'could not be saved' in result['reason']
    assert path.read_text() == '{"price":1.0}\n'


def test_daily_config_appends_only_enabled_commodity_indices(tmp_path, monkeypatch):
    legacy = {"id": "legacy", "source_type": "FRED"}
    original_index = {"id": "ca_bcpi_bcpi", "source_type": "CUSTOM"}
    path = tmp_path / "commodities.json"
    path.write_text(json.dumps([legacy, original_index]))
    configured = deepcopy(load_series())
    configured[1]["enabled"] = False
    monkeypatch.setattr(daily, "CONFIG_PATH", str(path))
    monkeypatch.setattr(daily, "load_series", lambda: configured)
    config = daily.load_config()
    assert config[:2] == [legacy, original_index]
    assert sum(row["id"] == "ca_bcpi_bcpi" for row in config) == 1
    assert all(row["reference_type"] == "commodity_index" for row in config[2:])
    assert "ca_bcpi_bcne" not in {row["id"] for row in config}
    references = daily.load_reference_config()
    assert len(references) == 14
    assert all(row["reference_type"] != "commodity_index" for row in references)
    assert not {row["id"] for row in config} & {row["id"] for row in references}


def test_daily_dispatch_passes_shared_global_client(monkeypatch):
    client = object()
    received = {}
    def fetcher(**kwargs):
        received.update(kwargs)
        return [{"date": "2026-10-02", "period": "2026-10-02", "price": 1.1}]
    monkeypatch.setitem(daily.FETCHER_REGISTRY, "GLOBAL_REFERENCE", fetcher)
    series = next(row for row in load_series() if row["id"] == "ecb_eur_usd")
    assert daily.fetch_new_data(series, client=client)
    assert received["client"] is client
    assert received["provider"] == "ecb"
    assert received["currency"] == "USD"


def test_daily_reference_update_keeps_archive_revisions_flags_and_storage_isolation(tmp_path, monkeypatch):
    series = next(row for row in load_series() if row["id"] == "de_hicp_annual_change")
    directory = tmp_path / "global-reference"
    directory.mkdir()
    path = directory / (series["id"] + ".json")
    old = {"date": "2026-07-01", "period": "2026-07", "price": 2.8, "status": "e"}
    existing = {"id": series["id"], "custom_metadata": "keep", "fetched_at": "2026-09-01T00:00:00Z",
                "history": [{"date": "2000-01-01", "period": "2000-01", "price": 1.0}, old],
                "revisions": [{"date": "1999-01-01", "note": "prior revision"}]}
    path.write_text(json.dumps(existing))
    rows = [{"date": "2026-07-01", "period": "2026-07", "price": 2.7},
            {"date": "2026-09-01", "period": "2026-09", "price": 3.3, "status": "p"}]
    monkeypatch.setattr(daily, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(daily, "fetch_new_data", lambda _: rows)
    assert daily.update_commodity(series)
    saved = json.loads(path.read_text())
    assert not (tmp_path / (series["id"] + ".json")).exists()
    assert saved["custom_metadata"] == "keep"
    assert saved["history"][0] == existing["history"][0]
    assert saved["history"][-1] == rows[-1]
    assert saved["period"] == "2026-09"
    assert saved["status"] == "p"
    assert saved["reference_type"] == "consumer_inflation"
    assert saved["unit"] == series["unit"]
    assert saved["revisions"][0] == existing["revisions"][0]
    assert saved["revisions"][1]["previous"] == old
    assert saved["revisions"][1]["replacement"] == rows[0]
    assert "status" not in saved["history"][1]  # The final replacement no longer has an estimate flag.
    assert daily.update_commodity(series)
    assert len(json.loads(path.read_text())["revisions"]) == 2  # Re-reading unchanged values adds no revisions.


def test_daily_official_commodity_index_stays_in_commodity_root(tmp_path, monkeypatch):
    series = next(row for row in load_series() if row["id"] == "ca_bcpi_bcpi")
    monkeypatch.setattr(daily, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(daily, "fetch_new_data", lambda _: [{"date": "2026-09-01", "period": "2026-09-01", "price": 746.36}])
    assert daily.update_commodity(series)
    saved = json.loads((tmp_path / "ca_bcpi_bcpi.json").read_text())
    assert saved["source_class"] == "official_index"
    assert saved["currency"] == "INDEX"
    assert saved["source_url"] == series["source_url"]
    assert not (tmp_path / "global-reference" / "ca_bcpi_bcpi.json").exists()


@pytest.mark.parametrize("contents", ['{"history":[]}', "invalid JSON"])
def test_daily_failed_or_unreadable_reference_never_overwrites_archive(tmp_path, monkeypatch, contents):
    series = next(row for row in load_series() if row["id"] == "ecb_eur_usd")
    directory = tmp_path / "global-reference"
    directory.mkdir()
    path = directory / (series["id"] + ".json")
    path.write_text(contents)
    monkeypatch.setattr(daily, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(daily, "fetch_new_data", lambda _: None)
    assert daily.update_commodity(series) is False
    assert path.read_text() == contents


def test_daily_run_shares_and_closes_one_bounded_global_client(tmp_path, monkeypatch):
    calls, clients = [], []
    class BatchClient:
        request_count = 0
        closed = False
        def __init__(self, max_requests):
            assert max_requests == 20
            clients.append(self)
        def close(self):
            self.closed = True
    index = next(row for row in load_series() if row["id"] == "ca_bcpi_bcpi")
    fx = next(row for row in load_series() if row["id"] == "ecb_eur_usd")
    legacy = {"id": "legacy", "source_type": "FRED"}
    monkeypatch.setattr(daily, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(daily, "OfficialClient", BatchClient)
    monkeypatch.setattr(daily, "load_config", lambda: [legacy, index])
    monkeypatch.setattr(daily, "load_reference_config", lambda: [fx])
    def update(series, client=None):
        calls.append((series["id"], client))
        return True
    monkeypatch.setattr(daily, "update_commodity", update)
    daily.main()
    assert len(clients) == 1
    assert calls == [("legacy", None), (index["id"], clients[0]), (fx["id"], clients[0])]
    assert clients[0].closed is True
