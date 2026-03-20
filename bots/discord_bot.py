#!/usr/bin/env python3
"""
BenchmarkWatcher Discord Bot
Provides commodity price data via Discord.

Commands:
    !help - Show help message
    !price <commodity> - Get price for a commodity (e.g., !price brent)
    !prices <category> - Get all prices for a category
    !top - Show top gainers and losers
    !list - Show available commodities
"""
import asyncio
import logging
import discord
from discord.ext import commands

from config import DISCORD_BOT_TOKEN, WEBSITE_URL, BOT_NAME, CATEGORIES
from data_reader import (
    get_commodity_data,
    get_commodities_by_category,
    format_compact_price,
    get_top_movers,
    get_available_commodities,
    search_commodity,
)

# Logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Bot setup
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix='!', intents=intents, help_command=None)


DISCORD_DESCRIPTION_LIMIT = 2048
DISCORD_FIELD_LIMIT = 1024


def _truncate(text: str, limit: int) -> str:
    """Truncate text to fit Discord's limits, cutting at the last full line."""
    if len(text) <= limit:
        return text
    return text[: limit - 4].rsplit('\n', 1)[0] + '\n…'


def create_embed(title: str, description: str, color: int = 0x0d7680) -> discord.Embed:
    """Create a styled embed with branding."""
    embed = discord.Embed(
        title=title,
        description=_truncate(description, DISCORD_DESCRIPTION_LIMIT),
        color=color
    )
    embed.set_footer(
        text=f"📊 Data from benchmarkwatcher.online",
        icon_url="https://benchmarkwatcher.online/static/images/favicon.png"
    )
    return embed


@bot.event
async def on_ready():
    """Called when bot is ready."""
    print(f"🚀 {BOT_NAME} (Discord) is running...")
    print(f"📊 Data from: {WEBSITE_URL}")
    print(f"Logged in as: {bot.user}")

    # Set presence
    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.watching,
            name="commodity prices | !help"
        )
    )


@bot.command(name='help')
async def help_command(ctx):
    """Show help message."""
    description = f"""
Get commodity benchmark prices.

**Commands:**
• `!price <commodity>` - Get a commodity price
  Example: `!price brent` or `!price gold`

• `!prices <category>` - Get all prices in a category
  Categories: `energy`, `precious`, `metals`, `agriculture`

• `!top` - Show top gainers and losers

• `!list` - Show all available commodities

**Quick examples:**
`!price oil` → Brent Crude price
`!price gold` → Gold price
`!prices energy` → All energy commodities

🔗 [Full dashboard]({WEBSITE_URL})
"""
    embed = create_embed(f"🛢️ {BOT_NAME}", description)
    await ctx.send(embed=embed)


@bot.command(name='price')
async def price_command(ctx, *, query: str = None):
    """Get price for a commodity."""
    if not query:
        embed = create_embed(
            "⚠️ Missing commodity",
            "Please specify a commodity.\n\nExample: `!price brent` or `!price gold`",
            color=0xffa500
        )
        await ctx.send(embed=embed)
        return

    # Run blocking I/O in a thread to avoid stalling the async event loop
    data = await asyncio.to_thread(search_commodity, query)

    if not data:
        available = (await asyncio.to_thread(get_available_commodities))[:5]
        embed = create_embed(
            f"❓ Commodity '{query}' not found",
            f"Try: `{', '.join(available)}`...\n\nUse `!list` to see all available commodities.",
            color=0xff0000
        )
        await ctx.send(embed=embed)
        return

    # Get data
    name = data.get('name', 'Unknown')
    price = data.get('price', 0)
    unit = data.get('unit', 'USD')
    date_str = data.get('date', '')

    derived = data.get('derived', {}).get('descriptive_stats', {})
    metrics = data.get('metrics', {})
    change = derived.get('abs_change_1_obs', metrics.get('change_1d', 0))
    change_pct = derived.get('pct_change_1_obs', metrics.get('pct_1d', 0))

    # Determine color
    if change_pct > 0:
        color = 0x00ff00  # Green
        direction = "📈"
        sign = "+"
    elif change_pct < 0:
        color = 0xff0000  # Red
        direction = "📉"
        sign = ""
    else:
        color = 0x808080  # Gray
        direction = "➡️"
        sign = ""

    # Create embed
    embed = discord.Embed(
        title=f"{direction} {name}",
        color=color
    )
    embed.add_field(name="Price", value=f"**${price:,.2f}**", inline=True)
    embed.add_field(name="Change", value=f"{sign}{change_pct:.2f}%", inline=True)
    embed.add_field(name="Updated", value=date_str, inline=True)
    embed.set_footer(text=f"📊 benchmarkwatcher.online")

    await ctx.send(embed=embed)


@bot.command(name='prices')
async def prices_command(ctx, category: str = None):
    """Get all prices for a category."""
    if not category:
        categories = ', '.join(CATEGORIES.keys())
        embed = create_embed(
            "⚠️ Missing category",
            f"Please specify a category.\n\nAvailable: `{categories}`\n\nExample: `!prices energy`",
            color=0xffa500
        )
        await ctx.send(embed=embed)
        return

    category = category.lower()

    if category not in CATEGORIES:
        categories = ', '.join(CATEGORIES.keys())
        embed = create_embed(
            f"❓ Unknown category '{category}'",
            f"Available: `{categories}`",
            color=0xff0000
        )
        await ctx.send(embed=embed)
        return

    # Run blocking I/O in a thread
    commodities = await asyncio.to_thread(get_commodities_by_category, category)

    if not commodities:
        await ctx.send(f"No data available for {category}.")
        return

    # Build description
    emoji_map = {'energy': '🛢️', 'precious': '🥇', 'metals': '⛏️', 'agriculture': '🌾'}
    emoji = emoji_map.get(category, '📊')

    lines = [format_compact_price(c) for c in commodities]
    description = '\n'.join(lines)

    embed = create_embed(f"{emoji} {category.title()} Commodities", description)
    await ctx.send(embed=embed)


@bot.command(name='top')
async def top_command(ctx):
    """Show top gainers and losers."""
    # Run blocking I/O in a thread
    gainers, losers = await asyncio.to_thread(get_top_movers, 5)

    # Gainers
    if gainers:
        gainer_lines = [f"{i}. {format_compact_price(c)}" for i, c in enumerate(gainers, 1)]
        gainer_text = '\n'.join(gainer_lines)
    else:
        gainer_text = "No gainers today."

    # Losers
    if losers:
        loser_lines = [f"{i}. {format_compact_price(c)}" for i, c in enumerate(losers, 1)]
        loser_text = '\n'.join(loser_lines)
    else:
        loser_text = "No losers today."

    embed = discord.Embed(title="📊 Top Movers", color=0x0d7680)
    embed.add_field(name="📈 Top Gainers", value=_truncate(gainer_text, DISCORD_FIELD_LIMIT), inline=False)
    embed.add_field(name="📉 Top Losers", value=_truncate(loser_text, DISCORD_FIELD_LIMIT), inline=False)
    embed.set_footer(text="📊 benchmarkwatcher.online")

    await ctx.send(embed=embed)


@bot.command(name='list')
async def list_command(ctx):
    """Show all available commodities."""
    description = ""

    for category, commodities in CATEGORIES.items():
        emoji_map = {'energy': '🛢️', 'precious': '🥇', 'metals': '⛏️', 'agriculture': '🌾'}
        emoji = emoji_map.get(category, '📊')

        names = [c.replace('_', ' ').title() for c in commodities[:5]]
        more = f" +{len(commodities) - 5} more" if len(commodities) > 5 else ""

        description += f"{emoji} **{category.title()}:** {', '.join(names)}{more}\n"

    description += "\nUse `!price <name>` to get prices."

    embed = create_embed("📋 Available Commodities", description)
    await ctx.send(embed=embed)


@bot.event
async def on_command_error(ctx, error):
    """Handle command errors."""
    if isinstance(error, commands.CommandNotFound):
        await ctx.send("❓ Unknown command. Use `!help` for available commands.")
    else:
        logger.error(f"Error: {error}")


def main():
    """Run the bot."""
    if not DISCORD_BOT_TOKEN:
        print("ERROR: DISCORD_BOT_TOKEN not set!")
        print("1. Create a bot at https://discord.com/developers/applications")
        print("2. Create .env file with: DISCORD_BOT_TOKEN=your_token")
        return

    bot.run(DISCORD_BOT_TOKEN)


if __name__ == '__main__':
    main()
