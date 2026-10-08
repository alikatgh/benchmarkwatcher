"""Offline WDI bulk-import checks using the real archive's CSV schemas."""

import csv
import io
import json
import sqlite3
import zipfile
from datetime import date

import pytest

from scripts import import_worldbank_library as wdi
from scripts.public_data_store import LibraryWriter, decode_metadata


COUNTRY_HEADER = ["Country Code", "Short Name", "Table Name", "2-alpha code", "Region", "Income Group", "Special Notes"]
SERIES_HEADER = ["Series Code", "Topic", "Indicator Name", "Short definition", "Long definition", "Unit of measure",
                 "Periodicity", "Source", "License Type", "Other notes", "Limitations and exceptions"]
YEAR = str(date.today().year)
DATA_HEADER = ["Country Name", "Country Code", "Indicator Name", "Indicator Code", "1999", "2000", "2001", "2002", YEAR]
POPULATION = ["SP.POP.TOTL", "People: Population", "Population, total", "Resident population", "Source definition, including coverage caveats.",
              "people", "Annual", "UN Population Division; national statistical offices", "CC BY-4.0", "", "Population coverage varies."]


def _csv(header, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(header)
    writer.writerows(rows)
    return stream.getvalue()


def archive(tmp_path, *, data=None, indicators=None, extra=None, data_name="WDICSV.csv", raw_data=None,
            archive_date=(2026, 10, 1, 12, 0, 0)):
    path = tmp_path / "wdi.zip"
    countries = [
        ["USA", "United States", "United States", "US", "North America", "High income", "US country caveat."],
        ["MNG", "Mongolia", "Mongolia", "MN", "East Asia & Pacific", "Upper middle income", ""],
        ["WLD", "World", "World", "1W", "", "", "Aggregate."],
        ["ZZZ", "Unknown economy", "Unknown economy", "ZZ", "North America", "High income", ""],
    ]
    if data is None:
        data = [["United States", "USA", "Population, total", "SP.POP.TOTL", "9", "10", "11", "", "NaN"],
                ["Mongolia", "MNG", "Population, total", "SP.POP.TOTL", "4", "5", "..", "-", "9999"],
                ["World", "WLD", "Population, total", "SP.POP.TOTL", "100", "200", "300", "400", "500"],
                ["Unknown economy", "ZZZ", "Population, total", "SP.POP.TOTL", "100", "200", "300", "400", "500"]]
    files = {
        "WDICountry.csv": _csv(COUNTRY_HEADER, countries),
        "WDISeries.csv": _csv(SERIES_HEADER, indicators or [POPULATION]),
        data_name: raw_data if raw_data is not None else _csv(DATA_HEADER, data),
        "WDIfootnote.csv": _csv(["CountryCode", "SeriesCode", "Year", "DESCRIPTION"], [
            ["USA", "SP.POP.TOTL", "YR2001", "Estimate; see source."],
            ["USA", "SP.POP.TOTL", "YR2001", "Estimate; see source."],
            ["USA", "SP.POP.TOTL", "YR2001", "Population coverage adjusted."],
            ["USA", "SP.POP.TOTL", "YR1999", "Outside requested range."],
            ["WLD", "SP.POP.TOTL", "YR2001", "Aggregate footnote."],
        ]),
        "WDIcountry-series.csv": _csv(["CountryCode", "SeriesCode", "DESCRIPTION"], [
            ["USA", "SP.POP.TOTL", "Country population coverage caveat."],
        ]),
        "WDIseries-time.csv": _csv(["SeriesCode", "Year", "DESCRIPTION"], [
            ["SP.POP.TOTL", "YR2001", "Census reference year."],
        ]),
    }
    files.update(extra or {})
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as file:
        for name, value in files.items():
            member = zipfile.ZipInfo(name, date_time=archive_date)
            member.compress_type = zipfile.ZIP_DEFLATED
            file.writestr(member, value)
    return path


def load(tmp_path, archive_path, **kwargs):
    return wdi.import_archive(archive_path, tmp_path / "library.sqlite3", scratch_dir=tmp_path,
        start_year=2000, end_year=2002, **kwargs)


def rows(tmp_path, table):
    with sqlite3.connect(tmp_path / "library.sqlite3") as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY 1,2")]


def test_imports_actual_countries_historical_years_and_missing_values(tmp_path):
    report = load(tmp_path, archive(tmp_path))
    definitions = rows(tmp_path, "series")
    assert {row["entity_id"] for row in definitions} == {"USA", "MNG"}
    assert {(row["period"], row["value"]) for row in rows(tmp_path, "observations")} == {("2000", 10), ("2001", 11), ("2000", 5)}
    assert all(row["entity_type"] == "country" and row["dataset"] == "WDI" for row in definitions)
    assert report["series_count"] == 2
    assert report["observation_count"] == 3
    assert report["writer"]["observation_count"] == 3
    assert report["excluded_economies"] == ["WLD", "ZZZ"]
    assert len(report["archive_sha256"]) == 64
    assert report["archive_evidence"]["data_member_modified"] == "2026-10-01T12:00:00"
    assert not list(tmp_path.glob("wdi-notes-*"))


def test_retains_precise_units_attribution_definitions_and_annotations(tmp_path):
    load(tmp_path, archive(tmp_path))
    definition = next(row for row in rows(tmp_path, "series") if row["entity_id"] == "USA")
    metadata = decode_metadata(definition["metadata"])
    assert definition["unit"] == "people"
    assert definition["source_url"].endswith("SP.POP.TOTL?locations=US")
    assert definition["license"] == "CC BY-4.0"
    assert "UN Population Division; national statistical offices" in definition["attribution"]
    assert metadata["Long definition"] == POPULATION[4]
    assert metadata["Limitations and exceptions"] == "Population coverage varies."
    assert metadata["country_metadata"]["Special Notes"] == "US country caveat."
    assert metadata["country_indicator_note"] == "Country population coverage caveat."
    assert metadata["license_url"] == wdi.TERMS_URL
    observation = next(row for row in rows(tmp_path, "observations") if row["period"] == "2001")
    notes = decode_metadata(observation["metadata"])
    assert notes["footnote"] == "Estimate; see source.\nPopulation coverage adjusted."
    assert notes["indicator_year_note"] == "Census reference year."


def test_default_range_keeps_available_pre_2000_history(tmp_path):
    report = wdi.import_archive(archive(tmp_path), tmp_path / "library.sqlite3",
                                scratch_dir=tmp_path, catalog_path=None)
    assert report["start_year"] == 1960
    assert report["end_year"] == date.today().year - 1
    assert {row["period"] for row in rows(tmp_path, "observations")} == {"1999", "2000", "2001", "2002"}


@pytest.mark.parametrize("year", ["yr2001", "Yr2001", "yR2001"])
def test_annotation_year_prefix_is_case_insensitive(tmp_path, year):
    # The official October 2026 archive includes 92 lowercase yrYYYY
    # footnotes on the anemia indicators; the prefix has the same meaning.
    note = "Original source uncertainty interval retained."
    extra = {"WDIfootnote.csv": _csv(["CountryCode", "SeriesCode", "Year", "DESCRIPTION"],
              [["USA", "SP.POP.TOTL", year, note]])}
    load(tmp_path, archive(tmp_path, extra=extra))
    point = next(row for row in rows(tmp_path, "observations") if row["period"] == "2001")
    assert decode_metadata(point["metadata"])["footnote"] == note


def test_malformed_annotation_year_still_preserves_existing_database(tmp_path):
    load(tmp_path, archive(tmp_path), fetched_at="2026-10-01T00:00:00Z")
    before = rows(tmp_path, "observations")
    extra = {"WDIfootnote.csv": _csv(["CountryCode", "SeriesCode", "Year", "DESCRIPTION"],
              [["USA", "SP.POP.TOTL", "yr20X1", "Malformed source year."]])}
    with pytest.raises(wdi.WorldBankImportError, match="invalid year"):
        load(tmp_path, archive(tmp_path, extra=extra), fetched_at="2026-10-02T00:00:00Z")
    assert rows(tmp_path, "observations") == before


def test_excludes_custom_licenses_and_restrictive_third_party_notes(tmp_path):
    restricted = [*POPULATION]
    restricted[0], restricted[8] = "TEST.RESTRICTED", "Custom license"
    conditional = [*POPULATION]
    conditional[0], conditional[9] = "TEST.CONDITIONAL", "These data may not be redistributed without permission."
    input_rows = [["United States", "USA", "Population, total", code, "", "10", "11", "", ""]
                  for code in ("SP.POP.TOTL", "TEST.RESTRICTED", "TEST.CONDITIONAL")]
    report = load(tmp_path, archive(tmp_path, data=input_rows, indicators=[POPULATION, restricted, conditional]))
    assert {row["indicator_id"] for row in rows(tmp_path, "series")} == {"SP.POP.TOTL"}
    assert set(report["excluded_indicators"]) == {"TEST.RESTRICTED", "TEST.CONDITIONAL"}


def test_preserves_distinct_open_igo_license_and_its_license_link(tmp_path):
    indicator = [*POPULATION]
    indicator[0], indicator[2], indicator[5], indicator[8] = (
        "GD_WBL_OVL_ENF", "WBL: Enforcement Perceptions Index (scale 0-100)", "scale 0-100", "CC BY 3.0 IGO")
    data = [["Mongolia", "MNG", indicator[2], indicator[0], "", "45", "", "", ""]]
    report = load(tmp_path, archive(tmp_path, data=data, indicators=[indicator]))
    saved = rows(tmp_path, "series")[0]
    assert saved["license"] == "CC BY 3.0 IGO"
    assert decode_metadata(saved["metadata"])["license_url"] == "https://creativecommons.org/licenses/by/3.0/igo/"
    assert not report["excluded_indicators"]


def test_default_license_uses_terms_and_unit_fallback_stays_explicit(tmp_path):
    measure = [*POPULATION]
    measure[0], measure[2], measure[5], measure[8] = "TEST.PCT", "Enrollment (% of population)", "", ""
    data = [["United States", "USA", measure[2], measure[0], "", "10", "11", "", ""]]
    load(tmp_path, archive(tmp_path, data=data, indicators=[measure]))
    definition = rows(tmp_path, "series")[0]
    metadata = decode_metadata(definition["metadata"])
    assert definition["unit"] == "% of population"
    assert metadata["license_evidence"] == "World Bank default dataset terms"
    assert "indicator title" in metadata["unit_basis"]


def test_preserves_real_lowercase_social_protection_indicator_codes(tmp_path):
    indicator = [*POPULATION]
    indicator[0] = "per_allsp.adq_pop_tot"
    indicator[2] = "Adequacy of social protection and labor programs (% of total welfare of beneficiary households)"
    indicator[5] = "%"
    data = [["Mongolia", "MNG", indicator[2], indicator[0], "", "4.5", "", "", ""]]
    load(tmp_path, archive(tmp_path, data=data, indicators=[indicator]))
    saved = rows(tmp_path, "series")[0]
    assert saved["indicator_id"] == "per_allsp.adq_pop_tot"
    assert "per_allsp.adq_pop_tot?locations=MN" in saved["source_url"]
    assert rows(tmp_path, "observations")[0]["value"] == 4.5


def test_preserves_original_decimal_text_when_plotting_float_loses_precision(tmp_path):
    raw = "12345678901234567890.123456789"
    data = [["Mongolia", "MNG", "Population, total", "SP.POP.TOTL", "", raw, "", "", ""]]
    load(tmp_path, archive(tmp_path, data=data))
    point = rows(tmp_path, "observations")[0]
    assert point["value"] == float(raw)
    assert decode_metadata(point["metadata"])["source_value"] == raw


def test_all_empty_series_are_skipped_and_do_not_erase_saved_history(tmp_path):
    load(tmp_path, archive(tmp_path), fetched_at="2026-10-01T00:00:00Z")
    data = [["United States", "USA", "Population, total", "SP.POP.TOTL", "", "", "NA", "..", ""],
            ["Mongolia", "MNG", "Population, total", "SP.POP.TOTL", "", "6", "", "", ""]]
    report = load(tmp_path, archive(tmp_path, data=data), fetched_at="2026-10-02T00:00:00Z")
    assert report["empty_series_count"] == 1
    assert report["series_count"] == 1
    assert len(rows(tmp_path, "observations")) == 3
    assert len(rows(tmp_path, "observation_revisions")) == 1


def test_refresh_preserves_missing_older_periods_and_archives_revisions(tmp_path):
    load(tmp_path, archive(tmp_path), fetched_at="2026-10-01T00:00:00Z")
    data = [["United States", "USA", "Population, total", "SP.POP.TOTL", "", "", "12", "13", ""]]
    report = load(tmp_path, archive(tmp_path, data=data), fetched_at="2026-10-02T00:00:00Z")
    usa = next(row for row in rows(tmp_path, "series") if row["entity_id"] == "USA")
    saved = {row["period"]: row["value"] for row in rows(tmp_path, "observations") if row["series_id"] == usa["id"]}
    assert saved == {"2000": 10, "2001": 12, "2002": 13}
    assert rows(tmp_path, "observation_revisions")[0]["value"] == 11
    assert report["writer"]["observation_count"] == 4


def test_older_archive_cannot_replace_a_newer_release_even_if_retrieved_today(tmp_path):
    load(tmp_path, archive(tmp_path), fetched_at="2026-10-01T00:00:00Z")
    before = rows(tmp_path, "observations")
    data = [["United States", "USA", "Population, total", "SP.POP.TOTL", "", "99", "99", "", ""]]
    path = archive(tmp_path, data=data, archive_date=(2026, 9, 1, 12, 0, 0))
    with pytest.raises(wdi.WorldBankImportError, match="older WDI archive"):
        load(tmp_path, path, fetched_at="2026-10-07T00:00:00Z")
    assert rows(tmp_path, "observations") == before


def test_interleaved_newer_archive_cannot_be_overwritten_after_annotations_load(tmp_path, monkeypatch):
    paths = {}
    for month, value in ((8, "10"), (9, "99"), (10, "77")):
        folder = tmp_path / str(month)
        folder.mkdir()
        data = [["United States", "USA", "Population, total", "SP.POP.TOTL", "", value, "", "", ""]]
        paths[month] = archive(folder, data=data, archive_date=(2026, month, 1, 12, 0, 0))
    load(tmp_path, paths[8], fetched_at="2026-10-01T00:00:00Z")
    original = wdi._Annotations.load

    def interleaved(self, opened_archive, *args):
        original(self, opened_archive, *args)
        if opened_archive.filename == str(paths[9]):
            load(tmp_path, paths[10], fetched_at="2026-10-06T00:00:00Z")

    monkeypatch.setattr(wdi._Annotations, "load", interleaved)
    with pytest.raises(wdi.WorldBankImportError, match="older WDI archive"):
        load(tmp_path, paths[9], fetched_at="2026-10-07T00:00:00Z")
    assert rows(tmp_path, "observations")[0]["value"] == 77
    assert len(rows(tmp_path, "observation_revisions")) == 1
    assert decode_metadata(rows(tmp_path, "series")[0]["metadata"])["archive_evidence"]["data_member_modified"] == "2026-10-01T12:00:00"


def test_vintage_guard_checks_all_series_instead_of_latest_retrieval_only(tmp_path):
    load(tmp_path, archive(tmp_path, archive_date=(2026, 9, 1, 12, 0, 0)), fetched_at="2026-10-01T00:00:00Z")
    definitions = rows(tmp_path, "series")
    latest_source = next(row for row in definitions if row["entity_id"] == "USA")
    latest_source["metadata"] = decode_metadata(latest_source["metadata"])
    latest_source["metadata"]["archive_evidence"]["data_member_modified"] = "2026-10-01T12:00:00"
    with LibraryWriter(tmp_path / "library.sqlite3", "worldbank", "WDI", "2026-10-02T00:00:00Z") as writer:
        writer.add_series(latest_source, [{"period": "2000", "value": 77}])
    later_retrieval = next(row for row in definitions if row["entity_id"] == "MNG")
    later_retrieval["metadata"] = decode_metadata(later_retrieval["metadata"])
    with LibraryWriter(tmp_path / "library.sqlite3", "worldbank", "WDI", "2026-10-03T00:00:00Z") as writer:
        writer.add_series(later_retrieval, [{"period": "2000", "value": 5}])
    before = rows(tmp_path, "observations")
    with pytest.raises(wdi.WorldBankImportError, match="older WDI archive"):
        load(tmp_path, archive(tmp_path, archive_date=(2026, 9, 1, 12, 0, 0)), fetched_at="2026-10-07T00:00:00Z")
    assert rows(tmp_path, "observations") == before


@pytest.mark.parametrize("bad", ["not numeric", "NaN", "inf", "-Infinity"])
def test_invalid_later_values_roll_back_the_entire_refresh(tmp_path, bad):
    load(tmp_path, archive(tmp_path), fetched_at="2026-10-01T00:00:00Z")
    before = {table: rows(tmp_path, table) for table in ("series", "observations", "observation_revisions", "datasets")}
    data = [["United States", "USA", "Population, total", "SP.POP.TOTL", "", "99", "11", "", ""],
            ["Mongolia", "MNG", "Population, total", "SP.POP.TOTL", "", bad, "", "", ""]]
    with pytest.raises(wdi.WorldBankImportError, match="WDI value"):
        load(tmp_path, archive(tmp_path, data=data), fetched_at="2026-10-02T00:00:00Z")
    assert {table: rows(tmp_path, table) for table in before} == before
    assert not list(tmp_path.glob("wdi-notes-*"))


@pytest.mark.parametrize("bad_archive", ["missing-metadata", "truncated-zip", "truncated-csv", "unsafe-path", "duplicate-data", "missing-unit-column"])
def test_bad_archives_preserve_existing_database(tmp_path, bad_archive):
    load(tmp_path, archive(tmp_path), fetched_at="2026-10-01T00:00:00Z")
    before = rows(tmp_path, "observations")
    path = archive(tmp_path)
    if bad_archive == "missing-metadata":
        with zipfile.ZipFile(path, "w") as file:
            file.writestr("WDICSV.csv", _csv(DATA_HEADER, []))
    elif bad_archive == "truncated-zip":
        path.write_bytes(path.read_bytes()[:-80])
    elif bad_archive == "truncated-csv":
        path = archive(tmp_path, raw_data=_csv(DATA_HEADER, [["United States", "USA", "Population, total", "SP.POP.TOTL", "", "99", "11", "", ""]]) + '"Mongolia,broken')
    elif bad_archive == "unsafe-path":
        path = archive(tmp_path, extra={"../escape.csv": "bad"})
    elif bad_archive == "duplicate-data":
        item = ["United States", "USA", "Population, total", "SP.POP.TOTL", "", "99", "11", "", ""]
        path = archive(tmp_path, data=[item, item])
    elif bad_archive == "missing-unit-column":
        path = archive(tmp_path, extra={"WDISeries.csv": _csv([key for key in SERIES_HEADER if key != "Unit of measure"], [[value for index, value in enumerate(POPULATION) if index != 5]])})
    with pytest.raises(wdi.WorldBankImportError):
        load(tmp_path, path, fetched_at="2026-10-02T00:00:00Z")
    assert rows(tmp_path, "observations") == before


@pytest.mark.parametrize("bounds", [(1899, 2000), (2002, 2001), (2000, date.today().year), (True, 2002)])
def test_year_bounds_are_historical(tmp_path, bounds):
    with pytest.raises(wdi.WorldBankImportError, match="historical years"):
        wdi.import_archive(archive(tmp_path), tmp_path / "library.sqlite3", scratch_dir=tmp_path,
                           start_year=bounds[0], end_year=bounds[1])
    assert not (tmp_path / "library.sqlite3").exists()


def test_zip_caps_and_older_data_member_format(tmp_path):
    path = archive(tmp_path, data_name="WDIData.csv")
    with pytest.raises(wdi.WorldBankImportError, match="compressed size cap"):
        load(tmp_path, path, max_download_mb=0.00001)
    with pytest.raises(wdi.WorldBankImportError, match="expanded size cap"):
        load(tmp_path, path, max_expanded_mb=0.00001)
    assert load(tmp_path, path)["series_count"] == 2


def test_offline_cli_performs_no_download(tmp_path, monkeypatch, capsys):
    def forbidden(*args, **kwargs):
        raise AssertionError("Offline import attempted a download")
    monkeypatch.setattr(wdi, "download_archive", forbidden)
    assert wdi.main(["--archive", str(archive(tmp_path)), "--database", str(tmp_path / "library.sqlite3"),
                     "--scratch-dir", str(tmp_path), "--start-year", "2000", "--end-year", "2002"]) == 0
    assert json.loads(capsys.readouterr().out)["observation_count"] == 3


class DownloadResponse:
    def __init__(self, chunks, *, status=200, declared=None):
        self.status_code = status
        self.chunks = chunks
        self.headers = {} if declared is None else {"Content-Length": str(declared)}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def iter_content(self, **kwargs):
        yield from self.chunks


@pytest.mark.parametrize("response,match", [
    (DownloadResponse([b"123456789"], declared=9), "download cap"),
    (DownloadResponse([b"123456789"]), "streaming download cap"),
    (DownloadResponse([b"12"], declared=4), "truncated"),
    (DownloadResponse([b"12"], status=302), "redirects are not followed"),
])
def test_download_caps_truncation_and_redirects_clean_only_owned_scratch(tmp_path, monkeypatch, response, match):
    import requests
    calls = []
    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return response
    monkeypatch.setattr(requests, "get", fake_get)
    original = tmp_path / "user-archive.zip"
    original.write_bytes(b"keep")
    with pytest.raises(wdi.WorldBankImportError, match=match):
        wdi.download_archive(tmp_path, max_download_mb=8 / (1024 * 1024))
    assert calls[0][0] == wdi.ARCHIVE_URL
    assert calls[0][1]["allow_redirects"] is False
    assert calls[0][1]["stream"] is True
    assert list(tmp_path.glob("*.zip")) == [original]
    assert original.read_bytes() == b"keep"
