"""
BenchmarkWatcher Bot Configuration
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Bot tokens from environment
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
DISCORD_BOT_TOKEN = os.getenv('DISCORD_BOT_TOKEN', '')

# Website URL for branding
WEBSITE_URL = 'https://benchmarkwatcher.online'

# Path to data directory (relative to this file)
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')

# Bot name
BOT_NAME = 'BenchmarkWatcher Bot'

# Commodity categories for /prices command
CATEGORIES = {
    'energy': ['brent_oil', 'wti_oil', 'natural_gas', 'heating_oil', 'gasoline', 'jet_fuel', 'propane'],
    'precious': ['gold', 'silver', 'platinum'],
    'metals': ['copper', 'iron_ore', 'aluminum', 'zinc', 'nickel', 'lead', 'tin'],
    'agriculture': ['wheat', 'corn', 'soybeans', 'rice', 'sugar', 'coffee', 'cocoa', 'cotton', 'rubber', 'palm_oil', 'beef', 'chicken'],
}

# Aliases for easier command input
ALIASES = {
    'brent': 'brent_oil',
    'wti': 'wti_oil',
    'gas': 'natural_gas',
    'natgas': 'natural_gas',
    'heating': 'heating_oil',
    'jet': 'jet_fuel',
    'oil': 'brent_oil',
    'crude': 'brent_oil',
}
