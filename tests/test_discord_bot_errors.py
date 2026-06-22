"""Tests for the Discord bot's error handler.

Proves on_command_error notifies the user (not only logs) on unexpected errors,
mirroring the Telegram error_handler — previously such errors were silently
swallowed (logged with no user-facing message).
"""
import asyncio
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

discord = pytest.importorskip("discord")
from discord.ext import commands  # noqa: E402


def load_discord_bot():
    """Load bots/discord_bot.py with stubbed config + a real data_reader.

    The real config requires bot tokens / env; stub it so import is side-effect
    free (module-level code only defines handlers; main() is __main__-guarded).
    """
    bots_dir = Path(__file__).resolve().parents[1] / "bots"

    fake_config = ModuleType("config")
    fake_config.DISCORD_BOT_TOKEN = "x"
    fake_config.WEBSITE_URL = "https://example.test"
    fake_config.BOT_NAME = "TestBot"
    fake_config.CATEGORIES = {}
    fake_config.DATA_DIR = str(bots_dir / ".." / "data")
    fake_config.ALIASES = {}

    # data_reader imports `from config import DATA_DIR, CATEGORIES, ALIASES`.
    original_config = sys.modules.get("config")
    original_dr = sys.modules.get("data_reader")
    original_db = sys.modules.get("discord_bot")
    sys.modules["config"] = fake_config

    added_path = str(bots_dir)
    path_inserted = added_path not in sys.path
    if path_inserted:
        sys.path.insert(0, added_path)
    try:
        spec = importlib.util.spec_from_file_location(
            "discord_bot", bots_dir / "discord_bot.py"
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules["discord_bot"] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if path_inserted:
            sys.path.remove(added_path)
        for name, original in (
            ("config", original_config),
            ("data_reader", original_dr),
            ("discord_bot", original_db),
        ):
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original


class _FakeCtx:
    def __init__(self):
        self.sent = []

    async def send(self, message):
        self.sent.append(message)


def test_on_command_error_notifies_user_on_unexpected_error():
    module = load_discord_bot()
    ctx = _FakeCtx()

    asyncio.run(module.on_command_error(ctx, RuntimeError("boom")))

    assert ctx.sent, "user should receive a message, not silent swallow"
    assert "error" in ctx.sent[0].lower()


def test_on_command_error_unknown_command_still_handled():
    module = load_discord_bot()
    ctx = _FakeCtx()

    asyncio.run(
        module.on_command_error(ctx, commands.CommandNotFound("nope"))
    )

    assert ctx.sent
    assert "Unknown command" in ctx.sent[0]
