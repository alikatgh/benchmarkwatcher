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
