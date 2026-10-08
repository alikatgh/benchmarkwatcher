"""Offline checks for official FAOSTAT schemas, identity, bounds and refreshes."""

import csv
from dataclasses import replace
from datetime import date
import io
import json
import sqlite3
import zipfile

import pytest

from scripts import import_faostat_library as fao
from scripts.public_data_store import decode_metadata


# Verified against 64 KiB prefixes from the official QCL and TCL archives. The
# RL archive has the same columns except Item Code (CPC).
HEADERS = ["Area Code", "Area Code (M49)", "Area", "Item Code", "Item Code (CPC)",
           "Item", "Element Code", "Element", "Year Code", "Year", "Unit", "Value", "Flag", "Note"]


def row(**changes):
    result = dict(zip(HEADERS, ["2", "'004", "Afghanistan", "221", "'01371",
                               "Almonds, in shell", "5312", "Area harvested",
                               "2024", "2024", "ha", "5900.000000", "E", ""]))
    result.update(changes)
    return result


def archive(tmp_path, rows, *, dataset="QCL", headers=None, flags=None, name="source.zip", extra=None):
    headers = headers or HEADERS
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=headers, extrasaction="ignore", lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    spec = fao.DATASETS[dataset]
    target = tmp_path / name
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(spec.csv_name, buffer.getvalue().encode("utf-8-sig"))
        if flags is not None:
            z.writestr(spec.companion("Flags"), flags)
        for member, text in (extra or {}).items():
            z.writestr(member, text)
    return target


def database_rows(path, table):
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(item) for item in conn.execute("SELECT * FROM " + table)]


def test_real_header_codes_units_zero_and_attribution_are_preserved():
    definition, observation = fao.parse_row(
        row(Value="0.000000", Flag="A"), end_year=2024,
        source_updated="2025-12-31T00:00:00", accessed_on=date(2026, 10, 7))
    assert definition["entity_id"] == "FAO:2"
    assert definition["country_code"] == "004"
    assert definition["indicator_id"] == "QCL:221:5312"
    assert definition["metadata"]["item_code_cpc"] == "01371"
    assert definition["metadata"]["country_code_system"] == "UN M49"
    assert definition["unit"] == "ha"
    assert definition["license"] == "CC-BY-4.0"
    assert "FAO. 2025." in definition["attribution"]
    assert "07 October 2026" in definition["attribution"]
    assert definition["metadata"]["terms_url"] == fao.TERMS_URL
    assert observation == {"period": "2024", "value": 0.0,
                           "metadata": {"flag": "A", "source_value": "0.000000"}}


@pytest.mark.parametrize("source_value", ["12345678901234567890.123456789", "1.234567890123456789e-12", "0.000000"])
def test_original_numeric_precision_is_preserved_in_the_store(tmp_path, source_value):
    path = archive(tmp_path, [row(Value=source_value)])
    db = tmp_path / "library.sqlite3"
    fao.import_faostat_archive(path, db, end_year=2024)
    observation = database_rows(db, "observations")[0]
    assert observation["value"] == float(source_value)
    assert decode_metadata(observation["metadata"])["source_value"] == source_value


@pytest.mark.parametrize("value,flag", [("", "A"), ("..", ""), ("NA", ""),
                                        ("NaN", ""), ("0", "M"), ("0", "L"), ("3", "O")])
def test_missing_values_and_missing_flags_do_not_become_zero(value, flag):
    assert fao.parse_row(row(Value=value, Flag=flag), end_year=2024) == (None, "missing")


def test_forecast_is_not_published_as_historical_fact():
    assert fao.parse_row(row(Flag="F"), end_year=2024) == (None, "forecast")


@pytest.mark.parametrize("code,m49,name", [
    ("5000", "'001", "World"), ("5400", "'150", "Europe"),
    ("351", "'159", "China"), ("265", "'159.03", "China (excluding intra-trade)"),
    ("261", "'097.1203", "European Union (12) (excluding intra-trade)"),
    ("266", "'097.1503", "European Union (15) (excluding intra-trade)"),
    ("268", "'097.2503", "European Union (25) (excluding intra-trade)"),
    ("269", "'097.2703", "European Union (27) (excluding Croatia) (excluding intra-trade)"),
])
def test_aggregate_rows_are_not_mislabeled_countries(code, m49, name):
    assert fao.parse_row(row(**{"Area Code": code, "Area Code (M49)": m49, "Area": name}),
                         end_year=2024) == (None, "aggregate")


@pytest.mark.parametrize("code,m49,name", [("41", "'156", "China; mainland"),
                                         ("96", "'344", "China; Hong Kong SAR"),
                                         ("277", "'728", "South Sudan")])
def test_country_and_territory_components_remain_separate(code, m49, name):
    definition, _ = fao.parse_row(row(**{"Area Code": code, "Area Code (M49)": m49, "Area": name}), end_year=2024)
    assert definition["entity_id"] == "FAO:" + code
    assert definition["entity_type"] == "country"
    assert definition["country_code"] == m49[1:]


@pytest.mark.parametrize("changes", [
    {"Value": "infinite"}, {"Value": "inf"}, {"Value": "-inf"},
    {"Area Code": "no-code"}, {"Item Code": ""}, {"Element Code": "1.1"},
    {"Year": "20xx"}, {"Year Code": "2023"}, {"Unit": ""}, {"Area Code (M49)": "ZZ"},
])
def test_malformed_observation_raises_instead_of_silently_truncating(changes):
    with pytest.raises(fao.FAOSTATError):
        fao.parse_row(row(**changes), end_year=2024)


def test_unit_changes_create_separate_series(tmp_path):
    path = archive(tmp_path, [row(Unit="ha"), row(Unit="1000 ha", Value="5.9")])
    summary = fao.import_faostat_archive(path, tmp_path / "library.sqlite3", end_year=2024)
    definitions = database_rows(tmp_path / "library.sqlite3", "series")
    assert summary["series_count"] == 2
    assert {item["unit"] for item in definitions} == {"ha", "1000 ha"}
    assert len({item["id"] for item in definitions}) == 2


def test_rl_header_without_cpc_uses_original_units(tmp_path):
    path = archive(tmp_path, [row(**{"Item Code": "6600", "Item": "Country area", "Element Code": "5110",
                                   "Element": "Area", "Unit": "1000 ha", "Value": "65286"})],
                   dataset="RL", headers=[h for h in HEADERS if h != "Item Code (CPC)"])
    db = tmp_path / "library.sqlite3"
    fao.import_faostat_archive(path, db, dataset="RL", end_year=2024)
    item = database_rows(db, "series")[0]
    assert item["indicator_id"] == "RL:6600:5110"
    assert item["unit"] == "1000 ha"
    assert decode_metadata(item["metadata"])["item_code_cpc"] == ""


def test_dataset_namespaces_do_not_mix_identical_item_and_element_ids(tmp_path):
    db = tmp_path / "library.sqlite3"
    for dataset in ("QCL", "RL", "TCL"):
        path = archive(tmp_path, [row()], dataset=dataset, name=dataset + ".zip")
        fao.import_faostat_archive(path, db, dataset=dataset, end_year=2024)
    definitions = database_rows(db, "series")
    assert {item["indicator_id"] for item in definitions} == {"QCL:221:5312", "RL:221:5312", "TCL:221:5312"}
    assert len({item["id"] for item in definitions}) == 3


def test_unsorted_trade_batches_merge_notes_flags_and_complete_counts(tmp_path, monkeypatch):
    seen_sizes = []
    original = fao.LibraryWriter

    class ObservedWriter(original):
        def add_series(self, definition, observations):
            seen_sizes.append(len(observations))
            return super().add_series(definition, observations)

    monkeypatch.setattr(fao, "LibraryWriter", ObservedWriter)
    rows = [row(**{"Year": str(year), "Year Code": str(year), "Area Code": code,
                   "Area Code (M49)": m49, "Area": name, "Element Code": "5610",
                   "Element": "Import quantity", "Unit": "t", "Flag": "X", "Note": "Trading partner estimate"})
            for year, code, m49, name in [(2024, "2", "'004", "Afghanistan"),
                                          (2023, "3", "'008", "Albania"),
                                          (2022, "2", "'004", "Afghanistan"),
                                          (2024, "3", "'008", "Albania"),
                                          (2023, "2", "'004", "Afghanistan")]]
    path = archive(tmp_path, rows, dataset="TCL", flags="Flag, Description\r\nX,Value from external organization\r\n")
    db = tmp_path / "library.sqlite3"
    summary = fao.import_faostat_archive(path, db, dataset="TCL", end_year=2024,
                                        limits=replace(fao.Limits(), batch_size=2))
    assert summary["observation_count"] == 5
    assert summary["series_count"] == 2
    assert summary["entity_count"] == 2
    assert len(seen_sizes) > 2 and max(seen_sizes) <= 2
    definitions = database_rows(db, "series")
    assert all(decode_metadata(item["metadata"])["flag_definitions"]["X"] == "Value from external organization" for item in definitions)
    observations = database_rows(db, "observations")
    assert all(decode_metadata(item["metadata"]) == {"flag": "X", "note": "Trading partner estimate",
                                                    "source_value": "5900.000000"} for item in observations)


def test_refresh_preserves_old_years_updates_values_and_records_revisions(tmp_path):
    db = tmp_path / "library.sqlite3"
    first = archive(tmp_path, [row(**{"Year": "2000", "Year Code": "2000", "Value": "1"}), row(Value="2")], name="first.zip")
    second = archive(tmp_path, [row(Value="3")], name="second.zip")
    fao.import_faostat_archive(first, db, end_year=2024, fetched_at="2026-10-07T00:00:00Z")
    fao.import_faostat_archive(second, db, end_year=2024, fetched_at="2026-10-07T01:00:00Z")
    fao.import_faostat_archive(second, db, end_year=2024, fetched_at="2026-10-07T02:00:00Z")
    observations = database_rows(db, "observations")
    assert {item["period"]: item["value"] for item in observations} == {"2000": 1.0, "2024": 3.0}
    revisions = database_rows(db, "observation_revisions")
    assert len(revisions) == 1 and revisions[0]["value"] == 2.0


def test_bad_later_row_rolls_back_previously_flushed_observations(tmp_path):
    db = tmp_path / "library.sqlite3"
    good = archive(tmp_path, [row(Value="2")], name="good.zip")
    bad = archive(tmp_path, [row(Value="3"), row(Value="corrupt")], name="bad.zip")
    fao.import_faostat_archive(good, db, end_year=2024)
    with pytest.raises(fao.FAOSTATError, match="numeric"):
        fao.import_faostat_archive(bad, db, end_year=2024, limits=replace(fao.Limits(), batch_size=1))
    assert database_rows(db, "observations")[0]["value"] == 2.0
    assert database_rows(db, "observation_revisions") == []


@pytest.mark.parametrize("older_source", ["2025-12-31", None])
def test_old_or_unknown_source_cannot_overwrite_newer_release_fetched_earlier(tmp_path, older_source):
    db = tmp_path / "library.sqlite3"
    newer = archive(tmp_path, [row(Value="2")], name="newer.zip")
    older = archive(tmp_path, [row(Value="999"), row(**{"Year": "2023", "Year Code": "2023"})], name="older.zip")
    fao.import_faostat_archive(newer, db, end_year=2024, source_updated="2026-10-02",
                               fetched_at="2026-10-07T00:00:00Z")
    tables = ("series", "observations", "observation_revisions", "datasets")
    before = {table: database_rows(db, table) for table in tables}
    with pytest.raises(fao.FAOSTATError, match="older|source update date"):
        fao.import_faostat_archive(older, db, end_year=2024, source_updated=older_source,
                                   fetched_at="2026-10-08T00:00:00Z",
                                   limits=replace(fao.Limits(), batch_size=1))
    assert {table: database_rows(db, table) for table in tables} == before


def test_vintage_guard_checks_all_series_not_just_latest_retrieval(tmp_path):
    db = tmp_path / "library.sqlite3"
    newer = archive(tmp_path, [row(Value="2")], name="newer.zip")
    fao.import_faostat_archive(newer, db, end_year=2024, source_updated="2026-10-02",
                               fetched_at="2026-10-07T00:00:00Z")
    # Simulate a legacy narrow refresh on a different series: its later fetch
    # does not invalidate the newer source release saved on the first series.
    definition, observation = fao.parse_row(row(**{"Item Code": "15", "Item": "Wheat"}),
                                              end_year=2024, source_updated="2025-12-31")
    with fao.LibraryWriter(db, "faostat", "QCL", fetched_at="2026-10-08T00:00:00Z") as writer:
        writer.add_series(definition, [observation])
    before = database_rows(db, "observations")
    older = archive(tmp_path, [row(Value="999")], name="older.zip")
    with pytest.raises(fao.FAOSTATError, match="older"):
        fao.import_faostat_archive(older, db, end_year=2024, source_updated="2025-12-31",
                                   fetched_at="2026-10-09T00:00:00Z")
    assert database_rows(db, "observations") == before
    assert database_rows(db, "observation_revisions") == []


def test_same_or_newer_version_survives_repeated_batched_writes(tmp_path):
    db = tmp_path / "library.sqlite3"
    source = archive(tmp_path, [row(**{"Year": "2023", "Year Code": "2023"}), row()])
    limits = replace(fao.Limits(), batch_size=1)
    for fetched_at, source_updated in [("2026-10-07T00:00:00Z", "2025-12-31"),
                                       ("2026-10-08T00:00:00Z", "2026-10-02"),
                                       ("2026-10-09T00:00:00Z", "2026-10-02")]:
        fao.import_faostat_archive(source, db, end_year=2024, source_updated=source_updated,
                                   fetched_at=fetched_at, limits=limits)
    assert database_rows(db, "observation_revisions") == []
    assert decode_metadata(database_rows(db, "series")[0]["metadata"])["source_updated_at"] == "2026-10-02"


def test_cached_series_still_preserves_each_year_flag_and_note(tmp_path):
    path = archive(tmp_path, [row(**{"Year": "2023", "Year Code": "2023", "Flag": "A", "Note": "Official survey"}),
                              row(Flag="E", Note="Estimate")])
    db = tmp_path / "library.sqlite3"
    fao.import_faostat_archive(path, db, end_year=2024)
    observations = database_rows(db, "observations")
    assert {item["period"]: decode_metadata(item["metadata"]) for item in observations} == {
        "2023": {"flag": "A", "note": "Official survey", "source_value": "5900.000000"},
        "2024": {"flag": "E", "note": "Estimate", "source_value": "5900.000000"}}


def test_time_bound_also_covers_small_archives(tmp_path, monkeypatch):
    path = archive(tmp_path, [row()])
    timestamps = iter([0.0, 2.0])
    monkeypatch.setattr(fao.time, "monotonic", lambda: next(timestamps))
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match="time bound"):
        fao.import_faostat_archive(path, db, end_year=2024, limits=replace(fao.Limits(), max_seconds=1))
    assert database_rows(db, "observations") == []


@pytest.mark.parametrize("change,match", [
    ({"max_archive_bytes": 1}, "compressed-size"),
    ({"max_uncompressed_bytes": 1}, "uncompressed-size"),
    ({"max_rows": 1, "batch_size": 1}, "row count"),
])
def test_archive_and_row_caps_fail_atomically(tmp_path, change, match):
    path = archive(tmp_path, [row(Value="1"), row(Value="2")])
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match=match):
        fao.import_faostat_archive(path, db, end_year=2024, limits=replace(fao.Limits(), **change))
    if db.exists():
        assert database_rows(db, "observations") == []


def test_archive_paths_and_compression_bombs_are_rejected(tmp_path):
    unsafe = archive(tmp_path, [row()], extra={"../outside.csv": "none"}, name="unsafe.zip")
    bomb = archive(tmp_path, [row()], extra={"padding.csv": "a" * 1_000_000}, name="bomb.zip")
    for path, match in [(unsafe, "Unsafe"), (bomb, "compression ratio")]:
        with pytest.raises(fao.FAOSTATError, match=match):
            fao.import_faostat_archive(path, tmp_path / "library.sqlite3", end_year=2024)


def test_bad_zip_wrong_member_and_missing_headers_are_rejected(tmp_path):
    bad_zip = tmp_path / "bad.zip"
    bad_zip.write_bytes(b"not a zip")
    wrong = tmp_path / "wrong.zip"
    with zipfile.ZipFile(wrong, "w") as z:
        z.writestr("other.csv", "Value\n1\n")
    missing = archive(tmp_path, [row()], headers=["Year", "Value"], name="missing.zip")
    for path in (bad_zip, wrong, missing):
        with pytest.raises(fao.FAOSTATError):
            fao.import_faostat_archive(path, tmp_path / "library.sqlite3", end_year=2024)


def test_duplicate_headers_are_rejected(tmp_path):
    path = archive(tmp_path, [row()], headers=[*HEADERS, "Value"])
    with pytest.raises(fao.FAOSTATError, match="duplicated"):
        fao.import_faostat_archive(path, tmp_path / "library.sqlite3", end_year=2024)


def test_row_shapes_and_field_size_limit_fail(tmp_path):
    shapes = tmp_path / "shapes.zip"
    with zipfile.ZipFile(shapes, "w") as z:
        z.writestr(fao.DATASETS["QCL"].csv_name, ",".join(HEADERS) + "\n2,extra\n")
    with pytest.raises(fao.FAOSTATError, match="header"):
        fao.import_faostat_archive(shapes, tmp_path / "library.sqlite3", end_year=2024)
    huge = archive(tmp_path, [row(Note="n" * 200)], name="large-field.zip")
    with pytest.raises(fao.FAOSTATError, match="Malformed"):
        fao.import_faostat_archive(huge, tmp_path / "library.sqlite3", end_year=2024,
                                  limits=replace(fao.Limits(), max_field_bytes=100))


def test_empty_selection_does_not_publish_success(tmp_path):
    path = archive(tmp_path, [row(**{"Area Code": "5000", "Area Code (M49)": "'001", "Area": "World"})])
    with pytest.raises(ValueError, match="No usable observations"):
        fao.import_faostat_archive(path, tmp_path / "library.sqlite3", end_year=2024)


def test_historical_bounds_reject_current_future_or_reversed_years():
    for start, end in [(2000, date.today().year), (2000, date.today().year + 1), (2024, 2023), (1899, 2000)]:
        with pytest.raises(fao.FAOSTATError, match="historical"):
            fao._years(start, end)


def test_default_window_preserves_pre_2000_history(tmp_path):
    source = archive(tmp_path, [row(**{"Year": "1961", "Year Code": "1961"}),
                               row(**{"Year": "1990", "Year Code": "1990"}), row()])
    db = tmp_path / "library.sqlite3"
    summary = fao.import_faostat_archive(source, db, end_year=2024)
    assert summary["start_year"] == 1900
    assert {r["period"] for r in database_rows(db, "observations")} == {"1961", "1990", "2024"}


@pytest.mark.parametrize("dataset", ["RP", "RFN", "RFB", "RT", "LC", "BE", "IC", "FDI", "CB", "GN",
                                    "QV", "FO", "CBH", "SCL", "IG", "MK", "PD", "PA", "RA", "RM", "RY",
                                    "EI", "EK", "EM", "EMN", "ESB", "GPP"])
def test_additional_reviewed_country_domains_preserve_units_codes_and_precision(tmp_path, dataset):
    source = archive(tmp_path, [row(Value="0.001230000", Flag="P")], dataset=dataset,
                     headers=[h for h in HEADERS if h != "Item Code (CPC)"])
    db = tmp_path / "library.sqlite3"
    summary = fao.import_faostat_archive(source, db, dataset=dataset, end_year=2024, source_updated="2026-07-30")
    definition = database_rows(db, "series")[0]
    observation = database_rows(db, "observations")[0]
    assert summary["dataset"] == dataset
    assert definition["indicator_id"] == dataset + ":221:5312"
    assert definition["unit"] == "ha"
    assert decode_metadata(definition["metadata"])["source_updated_at"] == "2026-07-30"
    assert decode_metadata(observation["metadata"]) == {"flag": "P", "source_value": "0.001230000"}


@pytest.mark.parametrize("dimension", ["Partner Code", "Sex", "Scenario", "Months", "Survey"])
def test_unknown_dimensions_are_rejected_without_flattening(dimension, tmp_path):
    data = row(**{dimension: "1"})
    with pytest.raises(fao.FAOSTATError, match="lose identity"):
        fao.parse_row(data, end_year=2024)
    source = archive(tmp_path, [data], headers=[*HEADERS, dimension])
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match="lose identity"):
        fao.import_faostat_archive(source, db, end_year=2024)
    assert database_rows(db, "observations") == []


@pytest.mark.parametrize("dataset,dimension", [("GF", "Source"), ("GV", "Source"), ("CAHD", "Release"),
                                              ("GCE", "Source"), ("GI", "Source"), ("GLE", "Source"), ("GT", "Source")])
def test_reviewed_source_and_release_dimensions_do_not_collide(tmp_path, dataset, dimension):
    data = [row(**{dimension + " Code": "1", dimension: "Source release one"}),
            row(**{dimension + " Code": "2", dimension: "Source release two", "Value": "3"})]
    source = archive(tmp_path, data, dataset=dataset, headers=[*HEADERS, dimension + " Code", dimension])
    db = tmp_path / "library.sqlite3"
    summary = fao.import_faostat_archive(source, db, dataset=dataset, end_year=2024)
    definitions = database_rows(db, "series")
    assert summary["series_count"] == summary["observation_count"] == 2
    assert {d["indicator_id"] for d in definitions} == {dataset + ":221:5312:" + dimension.lower() + "=" + code for code in ("1", "2")}
    assert {decode_metadata(d["metadata"])["source_dimensions"][dimension]["name"] for d in definitions} == {"Source release one", "Source release two"}
    assert len({d["id"] for d in definitions}) == 2


@pytest.mark.parametrize("dataset", ["FBS", "FBSH"])
def test_food_balance_item_alias_is_preserved_in_its_own_methodology_namespace(tmp_path, dataset):
    headers = [h for h in HEADERS if h != "Item Code (CPC)"] + ["Item Code (FBS)"]
    source = archive(tmp_path, [row(**{"Item Code (FBS)": "'S2501", "Item Code": "2501"})], dataset=dataset, headers=headers)
    db = tmp_path / "library.sqlite3"
    fao.import_faostat_archive(source, db, dataset=dataset, end_year=2024)
    definition = database_rows(db, "series")[0]
    assert definition["indicator_id"] == dataset + ":2501:5312"
    assert decode_metadata(definition["metadata"])["item_code_fbs"] == "S2501"


def test_known_indicator_measure_schema_uses_its_original_code_and_name():
    data = row(**{"Indicator Code": "1234", "Indicator": "Share of exports"})
    data.pop("Element")
    data.pop("Element Code")
    definition, _ = fao.parse_row(data, dataset="TCLI", end_year=2024)
    assert definition["indicator_id"] == "TCLI:221:1234"
    assert definition["indicator_name"].endswith("Share of exports")
    assert definition["metadata"]["measure_dimension"] == "Indicator"


def test_cahd_reviewed_alphanumeric_release_remains_exact_and_distinct(tmp_path):
    rows = [row(**{"Release Code": "7S2026", "Release": "July 2026 (SOFI report)", "Value": "3.141590000"}),
            row(**{"Release Code": "7", "Release": "Separate numeric release", "Value": "2.500000"})]
    source = archive(tmp_path, rows, dataset="CAHD", headers=[*HEADERS, "Release Code", "Release"])
    db = tmp_path / "library.sqlite3"
    summary = fao.import_faostat_archive(source, db, dataset="CAHD", end_year=2024)
    definitions = database_rows(db, "series")
    assert summary["series_count"] == summary["observation_count"] == 2
    assert {d["indicator_id"] for d in definitions} == {"CAHD:221:5312:release=7S2026", "CAHD:221:5312:release=7"}
    reviewed = next(d for d in definitions if d["indicator_id"].endswith("=7S2026"))
    assert decode_metadata(reviewed["metadata"])["source_dimensions"]["Release"] == {"code": "7S2026", "name": "July 2026 (SOFI report)"}
    observations = database_rows(db, "observations")
    assert {decode_metadata(o["metadata"])["source_value"] for o in observations} == {"3.141590000", "2.500000"}
    assert len({d["id"] for d in definitions}) == 2


@pytest.mark.parametrize("changes", [
    {"Release Code": "8S2027", "Release": "New release"},
    {"Release Code": "7s2026", "Release": "July 2026 (SOFI report)"},
    {"Release Code": "7S2026", "Release": "Unexpected revised release name"},
])
def test_cahd_unreviewed_release_code_or_name_rolls_back_flushed_rows(tmp_path, changes):
    valid = row(**{"Release Code": "7S2026", "Release": "July 2026 (SOFI report)"})
    invalid = row(**changes)
    source = archive(tmp_path, [valid, invalid], dataset="CAHD", headers=[*HEADERS, "Release Code", "Release"])
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match="release code"):
        fao.import_faostat_archive(source, db, dataset="CAHD", end_year=2024, limits=replace(fao.Limits(), batch_size=1))
    assert database_rows(db, "series") == []
    assert database_rows(db, "observations") == []


def test_alphanumeric_release_code_is_specific_to_reviewed_dataset_and_dimension():
    data = row(**{"Source Code": "7S2026", "Source": "July 2026 (SOFI report)"})
    with pytest.raises(fao.FAOSTATError, match="source code"):
        fao.parse_row(data, dataset="GF", end_year=2024)


def test_forecasts_use_flag_descriptions_and_explicit_dimensions():
    assert fao.parse_row(row(Flag="Z"), flags={"Z": "Projected value"}, end_year=2024) == (None, "forecast")
    data = row(**{"Source Code": "1", "Source": "Projected baseline"})
    assert fao.parse_row(data, dataset="GF", end_year=2024) == (None, "forecast")
    assert fao.parse_row(row(Flag="Q"), end_year=2024) == (None, "missing")


@pytest.mark.parametrize("code,name,unit,value", [
    ("6193", "Agriculture orientation index US$, 2015 prices", "index", "0.003690"),
    ("61631", "Ratio of Value Added (Agriculture, Forestry and Fishing) US$, 2015 prices", "ratio", "0.123450"),
])
def test_ic_blank_dimensionless_units_use_verified_official_metadata_and_keep_original_unit(code, name, unit, value):
    data = row(**{"Item Code": "23068", "Item": "Credit to Agriculture, Forestry and Fishing",
                  "Element Code": code, "Element": name, "Unit": "", "Value": value, "Flag": "A"})
    definition, observation = fao.parse_row(data, dataset="IC", end_year=2024)
    official_metadata = "https://data.fao.org/catalog/dataset/416665a7-6b87-4304-a476-9e73939d7181"
    assert definition["unit"] == unit
    assert definition["indicator_id"] == "IC:23068:" + code
    assert definition["metadata"]["source_unit"] == ""
    assert definition["metadata"]["unit_resolution"]["source_url"] == official_metadata
    assert definition["metadata"]["unit_resolution"]["resolved_unit"] == unit
    assert "numeric values unchanged" in definition["metadata"]["transformations"]
    assert observation["value"] == float(value)
    assert observation["metadata"] == {"flag": "A", "source_value": value, "source_unit": "", "unit_resolution_source": official_metadata}


@pytest.mark.parametrize("dataset,code,name", [
    ("IC", "6110", "Value US$"),
    ("IC", "6193", "An unexpected new indicator name"),
    ("QCL", "6193", "Agriculture orientation index US$, 2015 prices"),
    ("IG", "6197", "An unexpected new government expenditure indicator"),
    ("IG", "6110", "Value US$"),
    ("IC", "6197", "SDG 2.a.1: Agriculture Orientation Index (AOI) for Government Expenditure"),
])
def test_unit_metadata_resolution_never_fills_other_missing_units(dataset, code, name):
    data = row(**{"Element Code": code, "Element": name, "Unit": ""})
    with pytest.raises(fao.FAOSTATError, match="Missing FAOSTAT series name or unit"):
        fao.parse_row(data, dataset=dataset, end_year=2024)


def test_ic_source_units_are_authoritative_when_not_blank():
    data = row(**{"Element Code": "6193", "Element": "Agriculture orientation index US$, 2015 prices", "Unit": "source-specified unit"})
    definition, observation = fao.parse_row(data, dataset="IC", end_year=2024)
    assert definition["unit"] == "source-specified unit"
    assert "unit_resolution" not in definition["metadata"]
    assert "source_unit" not in observation["metadata"]


def test_ic_unexpected_blank_unit_rolls_back_a_prior_flushed_verified_index(tmp_path):
    valid = row(**{"Element Code": "6193", "Element": "Agriculture orientation index US$, 2015 prices", "Unit": ""})
    invalid = row(**{"Element Code": "6110", "Element": "Value US$", "Unit": ""})
    source = archive(tmp_path, [valid, invalid], dataset="IC", headers=[h for h in HEADERS if h != "Item Code (CPC)"])
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match="Missing FAOSTAT series name or unit"):
        fao.import_faostat_archive(source, db, dataset="IC", end_year=2024, limits=replace(fao.Limits(), batch_size=1))
    assert database_rows(db, "series") == []
    assert database_rows(db, "observations") == []


def test_ic_verified_dimensionless_units_and_provenance_survive_import(tmp_path):
    source = archive(tmp_path, [row(**{"Element Code": "6193", "Element": "Agriculture orientation index US$, 2015 prices", "Unit": ""}),
                               row(**{"Element Code": "61631", "Element": "Ratio of Value Added (Agriculture, Forestry and Fishing) US$, 2015 prices", "Unit": ""})],
                     dataset="IC", headers=[h for h in HEADERS if h != "Item Code (CPC)"])
    db = tmp_path / "library.sqlite3"
    summary = fao.import_faostat_archive(source, db, dataset="IC", end_year=2024)
    assert summary["observation_count"] == summary["series_count"] == 2
    assert {d["unit"] for d in database_rows(db, "series")} == {"index", "ratio"}
    assert all(decode_metadata(d["metadata"])["unit_resolution"]["source_unit"] == "" for d in database_rows(db, "series"))
    assert all(decode_metadata(o["metadata"])["source_unit"] == "" for o in database_rows(db, "observations"))


def test_ig_aoi_blank_unit_uses_official_ratio_unit_without_changing_value(tmp_path):
    data = row(**{"Element Code": "6197", "Element": "SDG 2.a.1: Agriculture Orientation Index (AOI) for Government Expenditure",
                  "Unit": "", "Value": "0.003690000", "Flag": "A"})
    source = archive(tmp_path, [data], dataset="IG")
    db = tmp_path / "library.sqlite3"
    fao.import_faostat_archive(source, db, dataset="IG", end_year=2024)
    definition = database_rows(db, "series")[0]
    metadata = decode_metadata(definition["metadata"])
    official = "https://data.fao.org/catalog/dataset/b2d69af9-55f2-4fb7-8876-389fec38eede"
    assert definition["unit"] == "ratio"
    assert definition["indicator_id"] == "IG:221:6197"
    assert metadata["source_unit"] == ""
    assert metadata["unit_resolution"]["source_unit"] == ""
    assert metadata["unit_resolution"]["resolved_unit"] == "ratio"
    assert metadata["unit_resolution"]["source_url"] == official
    observation = database_rows(db, "observations")[0]
    assert observation["value"] == float("0.003690000")
    assert decode_metadata(observation["metadata"]) == {"flag": "A", "source_value": "0.003690000", "source_unit": "", "unit_resolution_source": official}
    definition, observation = fao.parse_row({**data, "Unit": "%"}, dataset="IG", end_year=2024)
    assert definition["unit"] == "%"
    assert "unit_resolution" not in definition["metadata"]
    assert "source_unit" not in observation["metadata"]


def test_ig_unreviewed_blank_unit_rolls_back_prior_flushed_ratio(tmp_path):
    valid = row(**{"Element Code": "6197", "Element": "SDG 2.a.1: Agriculture Orientation Index (AOI) for Government Expenditure", "Unit": ""})
    source = archive(tmp_path, [valid, row(Unit="")], dataset="IG")
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match="Missing FAOSTAT series name or unit"):
        fao.import_faostat_archive(source, db, dataset="IG", end_year=2024, limits=replace(fao.Limits(), batch_size=1))
    assert database_rows(db, "series") == []
    assert database_rows(db, "observations") == []


@pytest.mark.parametrize("batch_size", [1, 100])
def test_duplicate_source_observations_fail_atomically_across_batch_boundaries(tmp_path, batch_size):
    source = archive(tmp_path, [row(), row(Value="8")])
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match="Duplicate FAOSTAT source observation"):
        fao.import_faostat_archive(source, db, end_year=2024, limits=replace(fao.Limits(), batch_size=batch_size))
    assert database_rows(db, "observations") == []
    assert database_rows(db, "observation_revisions") == []


def test_successful_archives_record_exact_window_counts_and_keep_prior_run_history(tmp_path):
    source = archive(tmp_path, [row(**{"Year": "1961", "Year Code": "1961"}), row(),
                               row(Value="", Flag="L"), row(Flag="F"),
                               row(**{"Area Code": "5000", "Area Code (M49)": "'001", "Area": "World"}),
                               row(**{"Year": "2027", "Year Code": "2027"})])
    db = tmp_path / "library.sqlite3"
    fao.import_faostat_archive(source, db, end_year=2024, source_updated="2026-07-30", fetched_at="2026-10-07T00:00:00Z")
    first = database_rows(db, "faostat_import_runs")[0]
    assert first == {"dataset": "QCL", "checked_at": "2026-10-07T00:00:00+00:00", "source_updated_at": "2026-07-30",
                     "start_year": 1900, "end_year": 2024, "archive_name": source.name, "archive_bytes": source.stat().st_size,
                     "rows_read": 6, "observations_imported": 2,
                     "skipped_counts": '{"aggregate":1,"forecast":1,"missing":1,"year":1}'}
    fao.import_faostat_archive(source, db, start_year=2024, end_year=2024, source_updated="2026-07-30", fetched_at="2026-10-08T00:00:00Z")
    runs = database_rows(db, "faostat_import_runs")
    assert len(runs) == 2
    assert runs[0] == first
    assert runs[1]["observations_imported"] == 1
    assert json.loads(runs[1]["skipped_counts"])["year"] == 2


def test_run_evidence_rolls_back_when_dataset_finalization_fails(tmp_path, monkeypatch):
    source = archive(tmp_path, [row()])
    db = tmp_path / "library.sqlite3"
    fao.import_faostat_archive(source, db, end_year=2024, fetched_at="2026-10-07T00:00:00Z")
    before_runs = database_rows(db, "faostat_import_runs")
    before_values = database_rows(db, "observations")

    def fail_finish(self):
        raise ValueError("Finalization failed")

    monkeypatch.setattr(fao.LibraryWriter, "_finish", fail_finish)
    with pytest.raises(ValueError, match="Finalization failed"):
        fao.import_faostat_archive(source, db, end_year=2024, fetched_at="2026-10-08T00:00:00Z")
    assert database_rows(db, "faostat_import_runs") == before_runs
    assert database_rows(db, "observations") == before_values


def test_reused_retrieval_timestamp_is_rejected_without_creating_another_run(tmp_path):
    source = archive(tmp_path, [row()])
    db = tmp_path / "library.sqlite3"
    stamp = "2026-10-07T00:00:00Z"
    fao.import_faostat_archive(source, db, end_year=2024, fetched_at=stamp)
    with pytest.raises(fao.FAOSTATError, match="distinct retrieval timestamp"):
        fao.import_faostat_archive(source, db, end_year=2024, fetched_at=stamp)
    assert len(database_rows(db, "faostat_import_runs")) == 1


def manifest_entry(code, *, url=None, name=None, description="", rows="100"):
    spec = fao.DATASETS.get(code)
    return (f"<Dataset><DatasetCode>{code}</DatasetCode><DatasetName>{name or (spec.name if spec else 'New domain')}</DatasetName>"
            f"<FileLocation>{url or (spec.archive_url if spec else fao.BULK_BASE + 'New_domain_E_All_Data_(Normalized).zip')}</FileLocation>"
            f"<DateUpdate>2026-07-30T00:00:00</DateUpdate><FileSize>743KB</FileSize><FileRows>{rows}</FileRows>"
            f"<DatasetDescription>{description}</DatasetDescription></Dataset>")


def test_catalog_discovers_supported_unsupported_and_new_domains_separately():
    content = ("<Datasets>" + manifest_entry("RP", description="Original source description") + manifest_entry("TM") + manifest_entry("ZZ") + "</Datasets>").encode()
    catalog = {d["dataset"]: d for d in fao.parse_manifest(content)}
    assert set(catalog) == {"RP", "TM", "ZZ"}
    assert catalog["RP"]["support_status"] == "supported"
    assert catalog["RP"]["reported_size_bytes"] == 743 * 1024
    assert catalog["RP"]["reported_row_count"] == 100
    assert catalog["RP"]["description"] == "Original source description"
    assert catalog["TM"]["support_status"] == "unsupported_dimensions"
    assert catalog["ZZ"]["support_status"] == "schema_review_required"
    assert all(d["coverage_status"] == "inventory_only" for d in catalog.values())


def test_tcli_known_schema_is_explicitly_blocked_pending_unit_identity_and_terms_review(tmp_path):
    content = ("<Datasets>" + manifest_entry("TCLI") + "</Datasets>").encode()
    entry = fao.parse_manifest(content)[0]
    assert entry["support_status"] == "unsupported_units"
    assert entry["measure_dimension"] == "Indicator"
    assert "509.02" in entry["support_reason"]
    assert "UNSD/Eurostat" in entry["support_reason"]
    assert entry["coverage_status"] == "inventory_only"
    with pytest.raises(fao.FAOSTATError, match="Unsupported FAOSTAT release"):
        fao.fetch_release(Session(Response(content)), "TCLI")
    data = row(**{"Indicator Code": "503", "Indicator": "Share of agricultural exports to GDP", "Unit": "%"})
    headers = [h for h in HEADERS if h not in {"Element", "Element Code"}] + ["Indicator Code", "Indicator"]
    source = archive(tmp_path, [data], dataset="TCLI", headers=headers)
    db = tmp_path / "library.sqlite3"
    with pytest.raises(fao.FAOSTATError, match="Unsupported FAOSTAT dataset"):
        fao.import_faostat_archive(source, db, dataset="TCLI", end_year=2024)
    assert not db.exists()


@pytest.mark.parametrize("code,name", [("501", "Import dependency ratio"), ("509.02", "Revealed comparative advantage index")])
def test_tcli_unreviewed_blank_units_and_decimal_codes_are_never_inferred(code, name):
    data = row(**{"Indicator Code": code, "Indicator": name, "Unit": ""})
    data.pop("Element")
    data.pop("Element Code")
    with pytest.raises(fao.FAOSTATError):
        fao.parse_row(data, dataset="TCLI", end_year=2024)


@pytest.mark.parametrize("content", [
    "<Datasets>" + manifest_entry("RP") + manifest_entry("RP") + "</Datasets>",
    "<Datasets>" + manifest_entry("ZZ", url="https://other.example/source.zip") + "</Datasets>",
    "<Datasets>" + manifest_entry("ZZ", url=fao.BULK_BASE + "../New_domain_E_All_Data_(Normalized).zip") + "</Datasets>",
    "<Datasets>" + manifest_entry("ZZ", url=fao.BULK_BASE + "New_domain_E_All_Data_(Normalized).zip?token=value") + "</Datasets>",
    "<Datasets>" + manifest_entry("ZZ", rows="not-rows") + "</Datasets>",
    '<!DOCTYPE Datasets [<!ENTITY x "replacement">]><Datasets></Datasets>',
])
def test_manifest_rejects_duplicates_untrusted_urls_and_malformed_inventory(content):
    with pytest.raises(fao.FAOSTATError):
        fao.parse_manifest(content.encode())


def test_manifest_refuses_non_utf8_entity_declarations_and_oversized_direct_inputs():
    dangerous = '<!DOCTYPE Datasets [<!ENTITY x "replacement">]><Datasets></Datasets>'.encode("utf-16")
    for content in (dangerous, b"x" * (fao.Limits.max_manifest_bytes + 1), b""):
        with pytest.raises(fao.FAOSTATError):
            fao.parse_manifest(content)


def test_supported_domain_url_changes_remain_visible_but_are_not_imported():
    content = ("<Datasets>" + manifest_entry("RP", url=fao.BULK_BASE + "Changed_E_All_Data_(Normalized).zip") + "</Datasets>").encode()
    assert fao.parse_manifest(content)[0]["support_status"] == "source_changed"
    with pytest.raises(fao.FAOSTATError, match="URL changed"):
        fao.fetch_release(Session(Response(content)), "RP")


def test_catalog_keeps_official_unsupported_formats_visible_without_import_claims():
    content = ("<Datasets>" + manifest_entry("ZZ", url=fao.BULK_BASE + "New_domain_Wide.xlsx") + "</Datasets>").encode()
    entry = fao.parse_manifest(content)[0]
    assert entry["support_status"] == "unsupported_format"
    assert entry["coverage_status"] == "inventory_only"


class Response:
    def __init__(self, content, headers=None, status=200):
        self.content, self.headers, self.status_code = content, headers or {}, status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def raise_for_status(self):
        return None

    def iter_content(self, size):
        for offset in range(0, len(self.content), size):
            yield self.content[offset:offset + size]


class Session:
    def __init__(self, response):
        self.response, self.calls = response, []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_official_manifest_is_bounded_and_url_is_verified():
    spec = fao.DATASETS["TCL"]
    text = f"<Datasets><Dataset><DatasetCode>TCL</DatasetCode><FileLocation>{spec.archive_url}</FileLocation><DateUpdate>2026-07-24T00:00:00</DateUpdate><FileSize>267104KB</FileSize><FileRows>17143873</FileRows></Dataset></Datasets>".encode()
    session = Session(Response(text, {"Content-Length": str(len(text))}))
    release = fao.fetch_release(session, "TCL")
    assert release["url"] == spec.archive_url
    assert release["source_updated"] == "2026-07-24"
    assert session.calls[0][0] == fao.MANIFEST_URL
    assert session.calls[0][1]["allow_redirects"] is False
    wrong = text.replace(spec.archive_url.encode(), b"https://other.example/data.zip")
    with pytest.raises(fao.FAOSTATError, match="URL changed"):
        fao.fetch_release(Session(Response(wrong)), "TCL")


@pytest.mark.parametrize("response,maximum", [
    (Response(b"1234", {"Content-Length": "100"}), 5),
    (Response(b"1234", {"Content-Length": "5"}), 10),
    (Response(b"123456", {}), 5),
    (Response(b"1234", {}, status=206), 5),
    (Response(b"", {}), 5),
])
def test_download_detects_oversize_truncated_and_partial_responses(response, maximum):
    with pytest.raises(fao.FAOSTATError):
        list(fao._http_chunks(Session(response), fao.DATASETS["QCL"].archive_url, fao.Limits(), maximum=maximum))


def test_download_never_overwrites_existing_archive(tmp_path):
    destination = tmp_path / "source.zip"
    destination.write_bytes(b"original")
    release = {"dataset": "QCL", "url": fao.DATASETS["QCL"].archive_url}
    with pytest.raises(FileExistsError):
        fao.download_archive(Session(Response(b"new")), release, destination)
    assert destination.read_bytes() == b"original"


def test_offline_cli_uses_no_network(tmp_path, monkeypatch, capsys):
    source = archive(tmp_path, [row()])

    def unexpected_network(*args, **kwargs):
        raise AssertionError("Offline import attempted network")

    monkeypatch.setattr(fao.requests, "Session", unexpected_network)
    status = fao.main(["--archive", str(source), "--database", str(tmp_path / "library.sqlite3"),
                       "--end-year", "2024", "--source-updated", "2025-12-31"])
    assert status == 0
    result = json.loads(capsys.readouterr().out)
    assert result["observation_count"] == 1 and result["source_updated_at"] == "2025-12-31"
    assert source.exists()


def test_catalog_cli_requires_no_database_and_does_not_download_archives(monkeypatch, capsys):
    content = ("<Datasets>" + manifest_entry("RP") + manifest_entry("TM") + "</Datasets>").encode()
    session = Session(Response(content))
    monkeypatch.setattr(fao.requests, "Session", lambda: session)
    assert fao.main(["--catalog"]) == 0
    catalog = json.loads(capsys.readouterr().out)
    assert catalog["dataset_count"] == 2
    assert len(session.calls) == 1
    assert session.calls[0][0] == fao.MANIFEST_URL
