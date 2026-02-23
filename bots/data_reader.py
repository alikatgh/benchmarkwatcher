"""
BenchmarkWatcher Data Reader (API Version)
Fetches data from benchmarkwatcher.online API with caching and rate limiting.

Thread-safe for async bot usage.
"""
import json
import time
import logging
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, List, Optional, Tuple, Any, Set
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

from config import WEBSITE_URL, CATEGORIES, ALIASES, INTERNAL_API_KEY

logger = logging.getLogger(__name__)

# =============================================================================
# CACHING - Prevents hammering the API
# =============================================================================

class DataCache:
    """Thread-safe in-memory cache with TTL."""
    
    def __init__(self, ttl_seconds: int = 300):  # 5 minute default
        self.ttl = ttl_seconds
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._lock = Lock()
    
    def get(self, key: str) -> Optional[Any]:
        """Get value if not expired."""
        with self._lock:
            if key in self._cache:
                timestamp, value = self._cache[key]
                if time.time() - timestamp < self.ttl:
                    return value
                # Don't delete - keep for stale fallback
            return None
    
    def get_stale(self, key: str) -> Optional[Any]:
        """Get value even if expired (for fallback)."""
        with self._lock:
            if key in self._cache:
                return self._cache[key][1]
            return None
    
    def set(self, key: str, value: Any) -> None:
        """Set value with current timestamp and prune old entries."""
        with self._lock:
            self._cache[key] = (time.time(), value)
            self._prune_old_entries()
    
    def _prune_old_entries(self) -> None:
        """Remove entries older than 10x TTL to prevent unbounded growth."""
        now = time.time()
        max_age = self.ttl * 10  # Keep stale for 10x TTL, then delete
        old_keys = [k for k, (ts, _) in self._cache.items() if now - ts > max_age]
        for k in old_keys:
            del self._cache[k]
    
    def clear(self) -> None:
        """Clear all cached data."""
        with self._lock:
            self._cache.clear()


# Global cache - 5 minute TTL (data updates daily anyway)
_cache = DataCache(ttl_seconds=300)

# CRITICAL: Fetch lock prevents thundering herd (cache stampede)
_fetch_lock = Lock()


# =============================================================================
# RATE LIMITING - Aggressive Protection
# =============================================================================

class RateLimiter:
    """
    Thread-safe, aggressive rate limiting with multiple layers:
    1. Per-user per-minute limit
    2. Per-user daily limit  
    3. Global daily limit (all users combined)
    4. Abuse detection (auto-ban)
    """
    
    def __init__(self):
        # Per-user: 5 requests per minute (very strict)
        self.user_minute_limit = 5
        self.minute_window = 60
        
        # Per-user: 50 requests per day
        self.user_daily_limit = 50
        
        # Global: 1000 requests per day total (all users)
        self.global_daily_limit = 1000
        
        # Abuse threshold: ban if user hits limit 5 times in an hour
        self.abuse_threshold = 5
        
        self._minute_requests: Dict[str, List[float]] = {}
        self._daily_requests: Dict[str, int] = {}
        self._global_daily_count = 0
        self._current_day = datetime.now(timezone.utc).date()  # Calendar day (UTC)
        self._violations: Dict[str, List[float]] = {}
        # Bans are temporary: user_id -> unban_timestamp
        self._banned_users: Dict[str, float] = {}
        self._lock = Lock()
    
    def _reset_if_new_day(self):
        """Reset daily counters at UTC midnight. Must be called with lock held."""
        today = datetime.now(timezone.utc).date()
        if today != self._current_day:
            self._daily_requests.clear()
            self._global_daily_count = 0
            self._violations.clear()
            # Also clear minute requests to prevent memory leak
            self._minute_requests.clear()
            self._current_day = today
            logger.info("Daily rate limit counters reset (new UTC day)")
        
        # Cleanup expired bans
        now = time.time()
        expired_bans = [u for u, t in self._banned_users.items() if now > t]
        for u in expired_bans:
            del self._banned_users[u]
    
    def is_banned(self, user_id: str) -> bool:
        """Check if user is banned for abuse. Thread-safe."""
        with self._lock:
            user_id = str(user_id)
            if user_id in self._banned_users:
                if time.time() < self._banned_users[user_id]:
                    return True
                del self._banned_users[user_id]
            return False
    
    def is_allowed(self, user_id: str) -> Tuple[bool, str]:
        """
        Check if request is allowed. Thread-safe.
        Returns: (allowed: bool, reason: str)
        """
        with self._lock:
            self._reset_if_new_day()
            now = time.time()
            user_id = str(user_id)
            
            # Check if banned (temporary bans)
            if user_id in self._banned_users:
                unban_time = self._banned_users[user_id]
                if now < unban_time:
                    remaining = int((unban_time - now) // 60) + 1
                    return False, f"🚫 Temporarily banned. Try again in {remaining} min."
                else:
                    del self._banned_users[user_id]  # Unban if expired
            
            # Check global daily limit
            if self._global_daily_count >= self.global_daily_limit:
                return False, "⚠️ Daily limit reached. Try again tomorrow."
            
            # Check user daily limit
            if self._daily_requests.get(user_id, 0) >= self.user_daily_limit:
                self._record_violation(user_id)
                return False, f"⚠️ You've reached your daily limit ({self.user_daily_limit} requests)."
            
            # Check user per-minute limit
            if user_id not in self._minute_requests:
                self._minute_requests[user_id] = []
            
            # Clean old minute requests
            self._minute_requests[user_id] = [
                t for t in self._minute_requests[user_id]
                if now - t < self.minute_window
            ]
            
            if len(self._minute_requests[user_id]) >= self.user_minute_limit:
                self._record_violation(user_id)
                wait = self._get_wait_time_unlocked(user_id)
                return False, f"⏳ Slow down! Wait {wait} seconds."
            
            # All checks passed - record the request
            self._minute_requests[user_id].append(now)
            self._daily_requests[user_id] = self._daily_requests.get(user_id, 0) + 1
            self._global_daily_count += 1
            
            return True, "ok"
    
    def _record_violation(self, user_id: str):
        """Record a rate limit violation and check for abuse."""
        now = time.time()
        if user_id not in self._violations:
            self._violations[user_id] = []
        
        # Clean old violations (keep last hour)
        self._violations[user_id] = [
            t for t in self._violations[user_id]
            if now - t < 3600
        ]
        
        self._violations[user_id].append(now)
        
        # Ban for 1 hour if too many violations
        if len(self._violations[user_id]) >= self.abuse_threshold:
            self._banned_users[user_id] = now + 3600  # 1 hour ban
            logger.warning(f"User {user_id} banned for 1 hour due to abuse.")
    
    def _get_wait_time_unlocked(self, user_id: str) -> int:
        """Get wait time (must be called with lock held)."""
        if user_id not in self._minute_requests or not self._minute_requests[user_id]:
            return 0
        oldest = min(self._minute_requests[user_id])
        wait = self.minute_window - (time.time() - oldest)
        return max(0, int(wait))
    
    def get_wait_time(self, user_id: str) -> int:
        """Get seconds until user can make another request. Thread-safe."""
        with self._lock:
            return self._get_wait_time_unlocked(str(user_id))
    
    def get_stats(self) -> Dict:
        """Get current usage stats. Thread-safe."""
        with self._lock:
            return {
                'global_today': self._global_daily_count,
                'global_limit': self.global_daily_limit,
                'banned_users': len(self._banned_users),
            }


# Global rate limiter instance
rate_limiter = RateLimiter()


# =============================================================================
# API CLIENT
# =============================================================================

API_URL = f"{WEBSITE_URL}/internal/api/commodities"


def fetch_from_api(max_retries: int = 3, backoff_base: float = 0.5) -> List[Dict]:
    """
    Fetch all commodities from the API with:
    - Caching
    - Thundering herd protection (double-check locking)
    - Retry with exponential backoff
    """
    # 1. Fast path: Check cache (no lock needed)
    cached = _cache.get('all_commodities')
    if cached is not None:
        return cached
    
    # 2. Slow path: Acquire fetch lock to prevent thundering herd
    with _fetch_lock:
        # Double-check: another thread may have filled cache while we waited
        cached = _cache.get('all_commodities')
        if cached is not None:
            return cached
        
        # 3. Actual network call with retry/backoff
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                headers = {'User-Agent': 'BenchmarkWatcher-Bot/1.0'}
                if INTERNAL_API_KEY:
                    headers['X-Internal-Key'] = INTERNAL_API_KEY
                request = Request(API_URL, headers=headers)
                with urlopen(request, timeout=10) as response:
                    data = json.loads(response.read().decode())
                    commodities = data.get('data', [])
                    
                    _cache.set('all_commodities', commodities)
                    logger.info(f"Fetched {len(commodities)} commodities from API")
                    return commodities
                    
            except (URLError, HTTPError) as e:
                last_error = e
                if attempt < max_retries:
                    sleep_time = backoff_base * (2 ** (attempt - 1))
                    logger.warning(f"API attempt {attempt} failed, retrying in {sleep_time:.1f}s: {e}")
                    time.sleep(sleep_time)
                else:
                    logger.error(f"API fetch failed after {max_retries} attempts: {e}")
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                break
        
        # Fallback to stale cache
        stale = _cache.get_stale('all_commodities')
        if stale is not None:
            logger.warning("Using stale cache fallback")
            return stale
        return []


# =============================================================================
# HELPERS
# =============================================================================

def normalize_id(s: str) -> str:
    """Normalize commodity IDs/names for stable, case-insensitive matching.

    Contract:
    - Strips leading/trailing whitespace, lowercases.
    - Removes spaces AND underscores so that 'brent_oil', 'brent oil', and
      'brentoil' all resolve to the same key 'brentoil'.
    - Also strips '.json' suffixes from filenames.

    Important: this normalization is applied symmetrically to both query
    strings and API-returned IDs, so round-tripping is safe as long as all
    IDs use only ASCII word characters (no camelCase or hyphens).
    """
    if not s:
        return ""
    v = s.lower().strip()
    v = v.replace('.json', '')
    v = v.replace(' ', '')
    v = v.replace('_', '')
    return v


def _safe_float(val, default: float = 0.0) -> float:
    """Safely cast value to float."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return float(default)


# =============================================================================
# PUBLIC API (Same interface as file-based version)
# =============================================================================

def get_commodity_data(commodity_id: str) -> Optional[Dict]:
    """Get a single commodity by ID or name (normalized matching)."""
    key = ALIASES.get(commodity_id.lower(), commodity_id.lower())
    key_norm = normalize_id(key)
    
    commodities = fetch_from_api()
    for c in commodities:
        c_id = normalize_id(c.get('id', ''))
        c_name = normalize_id(c.get('name', ''))
        if key_norm in (c_id, c_name):
            return c
    return None


def get_all_commodities() -> List[Dict]:
    """Get all commodities."""
    return fetch_from_api()


def get_commodities_by_category(category: str) -> List[Dict]:
    """Get commodities for a specific category (normalized matching)."""
    category = category.lower()
    if category not in CATEGORIES:
        return []
    
    all_commodities = fetch_from_api()
    category_ids = [normalize_id(c) for c in CATEGORIES[category]]
    
    result = []
    for c in all_commodities:
        c_id = normalize_id(c.get('id', ''))
        if c_id in category_ids:
            result.append(c)
    return result


def format_price_message(data: Dict, include_link: bool = True) -> str:
    """Format a commodity price for bot response."""
    name = data.get('name', 'Unknown')
    price = _safe_float(data.get('price', 0))
    
    # Get change from derived stats
    derived = data.get('derived_stats', {})
    change_pct = _safe_float(derived.get('pct_change_1_obs', data.get('change_percent', 0)))
    
    # Format date
    date_str = data.get('date', '')
    
    # Direction emoji
    if change_pct > 0:
        direction = '📈'
        sign = '+'
    elif change_pct < 0:
        direction = '📉'
        sign = ''
    else:
        direction = '➡️'
        sign = ''
    
    msg = f"{direction} **{name}**: ${price:,.2f} ({sign}{change_pct:.2f}%)"
    msg += f"\n   └ Updated: {date_str}"
    
    return msg


def format_compact_price(data: Dict) -> str:
    """Format a commodity price in compact form for lists."""
    name = data.get('name', 'Unknown')
    price = _safe_float(data.get('price', 0))
    
    derived = data.get('derived_stats', {})
    change_pct = _safe_float(derived.get('pct_change_1_obs', data.get('change_percent', 0)))
    
    if change_pct > 0:
        sign = '+'
        emoji = '🟢'
    elif change_pct < 0:
        sign = ''
        emoji = '🔴'
    else:
        sign = ''
        emoji = '⚪'
    
    return f"{emoji} {name}: ${price:,.2f} ({sign}{change_pct:.2f}%)"


def get_top_movers(limit: int = 5) -> Tuple[List[Dict], List[Dict]]:
    """Get top gainers and losers. Does not mutate cached data."""
    commodities = fetch_from_api()
    
    # Extract change percentage without mutating original objects
    def get_change(c: Dict) -> float:
        derived = c.get('derived_stats', {})
        return derived.get('pct_change_1_obs', c.get('change_percent', 0))
    
    # Sort by change
    sorted_commodities = sorted(commodities, key=get_change, reverse=True)
    
    gainers = [c for c in sorted_commodities if get_change(c) > 0][:limit]
    losers = [c for c in sorted_commodities if get_change(c) < 0][-limit:][::-1]
    
    return gainers, losers


def get_available_commodities() -> List[str]:
    """Get list of all available commodity names."""
    commodities = fetch_from_api()
    return sorted([c.get('name', '') for c in commodities if c.get('name')])


def search_commodity(query: str) -> Optional[Dict]:
    """Search for a commodity by name or alias."""
    query = query.lower().strip()
    
    # Check aliases first
    if query in ALIASES:
        return get_commodity_data(ALIASES[query])
    
    # Try direct match
    data = get_commodity_data(query)
    if data:
        return data
    
    # Try partial name match
    all_commodities = fetch_from_api()
    for c in all_commodities:
        if query in c.get('name', '').lower():
            return c
    
    return None
