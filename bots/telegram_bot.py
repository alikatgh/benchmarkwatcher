#!/usr/bin/env python3
"""
BenchmarkWatcher Telegram Bot
Provides commodity price data via Telegram.

Commands:
    /start, /help - Show help message
    /price <commodity> - Get price for a commodity (e.g., /price brent)
    /prices <category> - Get all prices for a category (energy, precious, metals, agriculture)
    /top - Show top gainers and losers
    /list - Show available commodities
"""
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
from telegram.constants import ParseMode

from config import TELEGRAM_BOT_TOKEN, WEBSITE_URL, BOT_NAME, CATEGORIES
from data_reader import (
    get_commodity_data,
    get_commodities_by_category,
    format_price_message,
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


def get_footer() -> str:
    """Standard footer with website link."""
    return f"\n\n📊 [benchmarkwatcher.online]({WEBSITE_URL})"


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command."""
    await help_command(update, context)


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /help command."""
    help_text = f"""
🛢️ **{BOT_NAME}**

Get real-time commodity benchmark prices.

**Commands:**
• `/price <commodity>` - Get a commodity price
  Example: `/price brent` or `/price gold`

• `/prices <category>` - Get all prices in a category
  Categories: `energy`, `precious`, `metals`, `agriculture`

• `/top` - Show top gainers and losers

• `/list` - Show all available commodities

**Quick examples:**
`/price oil` → Brent Crude price
`/price gold` → Gold price
`/prices energy` → All energy commodities
{get_footer()}
"""
    await update.message.reply_text(help_text, parse_mode=ParseMode.MARKDOWN, disable_web_page_preview=True)


async def price_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /price <commodity> command."""
    if not context.args:
        await update.message.reply_text(
            "⚠️ Please specify a commodity.\n\nExample: `/price brent` or `/price gold`",
            parse_mode=ParseMode.MARKDOWN
        )
        return
    
    query = ' '.join(context.args)
    data = search_commodity(query)
    
    if not data:
        available = get_available_commodities()[:10]
        await update.message.reply_text(
            f"❓ Commodity '{query}' not found.\n\n"
            f"Try: `{', '.join(available[:5])}`...\n\n"
            f"Use `/list` to see all available commodities.",
            parse_mode=ParseMode.MARKDOWN
        )
        return
    
    msg = format_price_message(data)
    msg += get_footer()
    
    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN, disable_web_page_preview=True)


async def prices_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /prices <category> command."""
    if not context.args:
        categories = ', '.join(CATEGORIES.keys())
        await update.message.reply_text(
            f"⚠️ Please specify a category.\n\n"
            f"Available: `{categories}`\n\n"
            f"Example: `/prices energy`",
            parse_mode=ParseMode.MARKDOWN
        )
        return
    
    category = context.args[0].lower()
    
    if category not in CATEGORIES:
        categories = ', '.join(CATEGORIES.keys())
        await update.message.reply_text(
            f"❓ Unknown category '{category}'.\n\n"
            f"Available: `{categories}`",
            parse_mode=ParseMode.MARKDOWN
        )
        return
    
    commodities = get_commodities_by_category(category)
    
    if not commodities:
        await update.message.reply_text(f"No data available for {category}.")
        return
    
    # Format response
    emoji_map = {'energy': '🛢️', 'precious': '🥇', 'metals': '⛏️', 'agriculture': '🌾'}
    emoji = emoji_map.get(category, '📊')
    
    msg = f"{emoji} **{category.title()} Commodities**\n\n"
    for c in commodities:
        msg += format_compact_price(c) + "\n"
    
    msg += get_footer()
    
    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN, disable_web_page_preview=True)


async def top_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /top command - show top movers."""
    gainers, losers = get_top_movers(5)
    
    msg = "📈 **Top Gainers**\n"
    if gainers:
        for i, c in enumerate(gainers, 1):
            msg += f"{i}. {format_compact_price(c)}\n"
    else:
        msg += "No gainers today.\n"
    
    msg += "\n📉 **Top Losers**\n"
    if losers:
        for i, c in enumerate(losers, 1):
            msg += f"{i}. {format_compact_price(c)}\n"
    else:
        msg += "No losers today.\n"
    
    msg += get_footer()
    
    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN, disable_web_page_preview=True)


async def list_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /list command - show all available commodities."""
    msg = "📋 **Available Commodities**\n\n"
    
    for category, commodities in CATEGORIES.items():
        emoji_map = {'energy': '🛢️', 'precious': '🥇', 'metals': '⛏️', 'agriculture': '🌾'}
        emoji = emoji_map.get(category, '📊')
        msg += f"{emoji} **{category.title()}:** "
        msg += ', '.join([c.replace('_', ' ').title() for c in commodities[:5]])
        if len(commodities) > 5:
            msg += f" +{len(commodities) - 5} more"
        msg += "\n"
    
    msg += "\nUse `/price <name>` to get prices."
    msg += get_footer()
    
    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN, disable_web_page_preview=True)


async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Log errors."""
    logger.error(f"Update {update} caused error {context.error}")


async def run_bot() -> None:
    """Async bot runner."""
    # Create application
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Add handlers
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("price", price_command))
    app.add_handler(CommandHandler("prices", prices_command))
    app.add_handler(CommandHandler("top", top_command))
    app.add_handler(CommandHandler("list", list_command))
    
    # Error handler
    app.add_error_handler(error_handler)
    
    # Start polling
    print(f"🚀 {BOT_NAME} (Telegram) is running...")
    print(f"📊 Data from: {WEBSITE_URL}")
    
    async with app:
        await app.start()
        await app.updater.start_polling(allowed_updates=Update.ALL_TYPES)
        
        # Keep running until interrupted
        import asyncio
        try:
            while True:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            await app.updater.stop()
            await app.stop()


def main() -> None:
    """Run the bot."""
    if not TELEGRAM_BOT_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN not set!")
        print("1. Get a token from @BotFather on Telegram")
        print("2. Create .env file with: TELEGRAM_BOT_TOKEN=your_token")
        return
    
    import asyncio
    asyncio.run(run_bot())


if __name__ == '__main__':
    main()
