"""Tests for bot data-reader safety helpers."""
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType


def load_bot_data_reader(data_dir: Path):
    """Load bots/data_reader.py with a controlled bot config module."""
    fake_config = ModuleType("config")
    fake_config.DATA_DIR = str(data_dir)
    fake_config.CATEGORIES = {"energy": ["brent_oil"]}
    fake_config.ALIASES = {"brent": "brent_oil"}

    original_config = sys.modules.get("config")
    sys.modules["config"] = fake_config
    try:
        module_path = Path(__file__).resolve().parents[1] / "bots" / "data_reader.py"
        spec = importlib.util.spec_from_file_location("bot_data_reader_under_test", module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if original_config is None:
            sys.modules.pop("config", None)
        else:
            sys.modules["config"] = original_config


def test_get_commodity_data_rejects_unsafe_ids(tmp_path):
    reader = load_bot_data_reader(tmp_path)

    assert reader.get_commodity_data("../config") is None
    assert reader.get_commodity_data("bad/name") is None
    assert reader.get_commodity_data(None) is None


def test_get_commodity_data_resolves_alias_inside_data_dir(tmp_path):
    commodity = {
        "id": "brent_oil",
        "name": "Brent Crude Oil",
        "price": 75.25,
        "history": [],
    }
    (tmp_path / "brent_oil.json").write_text(json.dumps(commodity))

    reader = load_bot_data_reader(tmp_path)

    assert reader.get_commodity_data("brent")["name"] == "Brent Crude Oil"


# ---------------------------------------------------------------------------
# None / non-numeric coercion (Bugs 2,3,4): <2-obs commodities store a
# present-but-None pct; price can be null. Formatting/sorting must not crash.
# ---------------------------------------------------------------------------

def _none_pct_commodity():
    return {
        "id": "newcoin",
        "name": "New Coin",
        "price": 100.0,
        # Both pct sources present-but-None (a single-observation commodity).
        "derived": {"descriptive_stats": {"pct_change_1_obs": None}},
        "metrics": {"pct_1d": None},
    }


def test_coerce_pct_handles_present_but_none(tmp_path):
    reader = load_bot_data_reader(tmp_path)
    assert reader._coerce_pct(_none_pct_commodity()) == 0.0
    # Absent entirely also coerces to 0.0.
    assert reader._coerce_pct({}) == 0.0
    # A real value passes through.
    assert reader._coerce_pct(
        {"derived": {"descriptive_stats": {"pct_change_1_obs": 4.2}}}
    ) == 4.2


def test_coerce_price_handles_null_and_non_numeric(tmp_path):
    reader = load_bot_data_reader(tmp_path)
    assert reader._coerce_price(None) == 0.0
    assert reader._coerce_price("n/a") == 0.0
    assert reader._coerce_price(True) == 0.0  # bool is not a real price
    assert reader._coerce_price(12.5) == 12.5
    assert reader._coerce_price(7) == 7.0


def test_format_messages_do_not_crash_on_none_pct(tmp_path):
    reader = load_bot_data_reader(tmp_path)
    data = _none_pct_commodity()
    # Neither formatter should raise on the None pct.
    msg = reader.format_price_message(data)
    compact = reader.format_compact_price(data)
    assert "New Coin" in msg
    assert "0.00%" in msg
    assert "0.00%" in compact


def test_format_messages_do_not_crash_on_null_price(tmp_path):
    reader = load_bot_data_reader(tmp_path)
    data = {"name": "Broken", "price": None,
            "derived": {"descriptive_stats": {"pct_change_1_obs": None}}}
    assert "$0.00" in reader.format_price_message(data)
    assert "$0.00" in reader.format_compact_price(data)


def test_get_top_movers_does_not_crash_on_none_pct(tmp_path):
    # A <2-obs commodity with present-but-None pct must not crash the sort.
    (tmp_path / "newcoin.json").write_text(json.dumps(_none_pct_commodity()))
    (tmp_path / "gainer.json").write_text(json.dumps({
        "name": "Gainer", "price": 10.0,
        "derived": {"descriptive_stats": {"pct_change_1_obs": 5.0}},
    }))
    (tmp_path / "loser.json").write_text(json.dumps({
        "name": "Loser", "price": 10.0,
        "derived": {"descriptive_stats": {"pct_change_1_obs": -3.0}},
    }))

    reader = load_bot_data_reader(tmp_path)
    gainers, losers = reader.get_top_movers(5)
    assert [g["name"] for g in gainers] == ["Gainer"]
    assert [l["name"] for l in losers] == ["Loser"]


def test_get_all_commodities_caches_directory_scan(tmp_path, monkeypatch):
    (tmp_path / "a.json").write_text(json.dumps({"name": "A", "price": 1.0}))
    reader = load_bot_data_reader(tmp_path)
    reader._invalidate_all_commodities_cache()

    calls = {"n": 0}
    real_listdir = reader.os.listdir

    def counting_listdir(path):
        calls["n"] += 1
        return real_listdir(path)

    monkeypatch.setattr(reader.os, "listdir", counting_listdir)

    first = reader.get_all_commodities()
    second = reader.get_all_commodities()
    assert len(first) == 1
    # Second call served from cache: no extra directory scan.
    assert calls["n"] == 1
    assert second == first
