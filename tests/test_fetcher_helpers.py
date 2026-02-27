"""Tests for fetcher shared utilities and extracted pure helpers."""

from typing import Any, Dict, List

from scripts.fetchers._shared import Observation, SmartDateParser, merge_history, parse_records
from scripts.fetchers.eia import _build_eia_params  # pyright: ignore[reportPrivateUsage]
from scripts.fetchers.usda import _resolve_month, _parse_usda_records  # pyright: ignore[reportPrivateUsage]
from scripts.fetchers.yahoo import _timestamps_to_observations  # pyright: ignore[reportPrivateUsage]


# ---------------------------------------------------------------------------
# SmartDateParser
# ---------------------------------------------------------------------------

class TestSmartDateParser:
    def test_iso_format(self) -> None:
        p = SmartDateParser()
        assert p.parse("2026-02-28") == "2026-02-28"

    def test_iso_with_time(self) -> None:
        p = SmartDateParser()
        assert p.parse("2026-02-28T14:30:00") == "2026-02-28"

    def test_fast_path_reuses_last_format(self) -> None:
        p = SmartDateParser()
        p.parse("2026-01-01")
        assert p._last_working_fmt == "%Y-%m-%d"  # pyright: ignore[reportPrivateUsage]
        # Second call uses fast path
        assert p.parse("2026-12-31") == "2026-12-31"

    def test_empty_returns_none(self) -> None:
        p = SmartDateParser()
        assert p.parse("") is None
        assert p.parse(None) is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# parse_records (shared FRED/EIA helper)
# ---------------------------------------------------------------------------

class TestParseRecords:
    def test_basic_parsing(self) -> None:
        raw: List[Dict[str, Any]] = [
            {"date": "2026-02-01", "value": "123.45"},
            {"date": "2026-01-01", "value": "100.00"},
        ]
        result = parse_records(raw, value_key="value", date_key="date")
        assert len(result) == 2
        # Reversed → oldest first
        assert result[0]["date"] == "2026-01-01"
        assert result[1]["price"] == 123.45

    def test_skips_none_and_dots(self) -> None:
        raw: List[Dict[str, Any]] = [
            {"date": "2026-01-01", "value": "."},
            {"date": "2026-01-02", "value": None},
            {"date": "2026-01-03", "value": "50"},
        ]
        result = parse_records(raw, value_key="value", date_key="date", skip_values=(".", ""))
        assert len(result) == 1
        assert result[0]["price"] == 50.0

    def test_custom_keys(self) -> None:
        raw: List[Dict[str, Any]] = [{"period": "2026-03-01", "value": "7.5"}]
        result = parse_records(raw, value_key="value", date_key="period")
        assert result[0]["date"] == "2026-03-01"

    def test_empty_input(self) -> None:
        assert parse_records([]) == []


# ---------------------------------------------------------------------------
# merge_history
# ---------------------------------------------------------------------------

class TestMergeHistory:
    def test_deduplicates_and_sorts(self) -> None:
        existing: List[Observation] = [{"date": "2026-01-01", "price": 100}]
        new: List[Observation] = [{"date": "2026-01-01", "price": 110}, {"date": "2026-01-02", "price": 120}]
        merged = merge_history(existing, new)
        assert len(merged) == 2
        assert merged[0]["price"] == 110  # overwritten by new
        assert merged[1]["date"] == "2026-01-02"

    def test_empty_existing(self) -> None:
        merged = merge_history([], [{"date": "2026-01-01", "price": 50}])
        assert len(merged) == 1


# ---------------------------------------------------------------------------
# EIA _build_eia_params
# ---------------------------------------------------------------------------

class TestBuildEiaParams:
    def test_single_facet(self) -> None:
        params = _build_eia_params("KEY", {"product": ["EPM0"]}, 100)
        keys = [k for k, _ in params]
        assert "api_key" in keys
        assert "facets[product][]" in keys

    def test_multi_value_facets_preserved(self) -> None:
        params = _build_eia_params("KEY", {"product": ["A", "B"]}, 100)
        facet_values = [v for k, v in params if k == "facets[product][]"]
        assert facet_values == ["A", "B"]


# ---------------------------------------------------------------------------
# USDA helpers
# ---------------------------------------------------------------------------

class TestResolveMonth:
    def test_known_months(self) -> None:
        assert _resolve_month({"reference_period_desc": "JAN"}) == "01"
        assert _resolve_month({"reference_period_desc": "DEC"}) == "12"

    def test_annual_maps_to_june(self) -> None:
        assert _resolve_month({"reference_period_desc": "YEAR"}) == "06"

    def test_fallback_to_begin_code(self) -> None:
        assert _resolve_month({"reference_period_desc": "UNKNOWN", "begin_code": "3"}) == "03"

    def test_returns_none_on_failure(self) -> None:
        assert _resolve_month({"reference_period_desc": "UNKNOWN"}) is None


class TestParseUsdaRecords:
    def test_basic(self) -> None:
        records: List[Dict[str, Any]] = [
            {"Value": "5.50", "year": "2025", "reference_period_desc": "JAN"},
            {"Value": "6.00", "year": "2025", "reference_period_desc": "FEB"},
        ]
        result = _parse_usda_records(records)
        assert len(result) == 2
        assert result[0]["date"] == "2025-01-01"
        assert result[1]["price"] == 6.0

    def test_skips_suppressed_values(self) -> None:
        records: List[Dict[str, Any]] = [
            {"Value": "(D)", "year": "2025", "reference_period_desc": "JAN"},
            {"Value": "5.00", "year": "2025", "reference_period_desc": "FEB"},
        ]
        result = _parse_usda_records(records)
        assert len(result) == 1

    def test_deduplicates_by_date(self) -> None:
        records: List[Dict[str, Any]] = [
            {"Value": "5.00", "year": "2025", "reference_period_desc": "JAN"},
            {"Value": "5.50", "year": "2025", "reference_period_desc": "JAN"},
        ]
        result = _parse_usda_records(records)
        assert len(result) == 1
        assert result[0]["price"] == 5.50  # last wins


# ---------------------------------------------------------------------------
# Yahoo _timestamps_to_observations
# ---------------------------------------------------------------------------

class TestTimestampsToObservations:
    def test_basic(self) -> None:
        # 2026-01-01 00:00:00 UTC
        ts = [1767225600, 1767312000]
        closes: List[float | None] = [100.0, 200.0]
        result = _timestamps_to_observations(ts, closes)
        assert len(result) == 2
        assert result[0]["date"] == "2026-01-01"
        assert result[1]["price"] == 200.0

    def test_skips_none_prices(self) -> None:
        result = _timestamps_to_observations([1767225600], [None])
        assert result == []
