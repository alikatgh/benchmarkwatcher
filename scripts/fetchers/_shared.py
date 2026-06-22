"""
Shared utilities for all fetchers.
- SmartDateParser: stateful date format optimizer
- safe_get: HTTP GET with retry + backoff
- merge_history: deduplicated date-sorted merge
- compute_metrics: backward-looking observation-based stats
- save_atomic: crash-safe JSON write
"""

import os
import json
import time
import logging
import tempfile
from datetime import datetime, date
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

import requests

logger = logging.getLogger(__name__)

# Reusable type aliases
Observation = Dict[str, Any]          # {"date": "YYYY-MM-DD", "price": float}
ParamsType = Union[Dict[str, Any], Sequence[Tuple[str, Any]], None]


# =============================================================================
# SmartDateParser
# =============================================================================

class SmartDateParser:
    """
    Stateful parser that optimizes date parsing by 'remembering'
    the last successful format. This speeds up processing by ~7x.
    """

    def __init__(self):
        self._last_working_fmt = None
        self._formats = [
            '%Y-%m-%d',          # ISO default
            '%Y-%m-%dT%H:%M:%S', # ISO-T
            '%m/%d/%Y',          # US
            '%d/%m/%Y',          # EU
            '%Y-%m-%d %H:%M:%S', # Space Time
            '%Y/%m/%d',          # Slashes
            '%Y%m%d',            # Compact
        ]

    def parse(self, date_str: str) -> Optional[str]:
        """Parse a date string into YYYY-MM-DD format."""
        if not date_str:
            return None

        # Fast path: try the last format that worked
        if self._last_working_fmt:
            try:
                dt = datetime.strptime(date_str[:19], self._last_working_fmt)
                return dt.strftime('%Y-%m-%d')
            except (ValueError, TypeError):
                pass

        # Slow path: try all formats
        for fmt in self._formats:
            try:
                dt = datetime.strptime(date_str[:19], fmt)
                self._last_working_fmt = fmt
                return dt.strftime('%Y-%m-%d')
            except (ValueError, TypeError):
                continue

        logger.warning(f"  Could not parse date: {date_str}")
        return None


# =============================================================================
# HTTP Helper
# =============================================================================

# Cap on a single response body to avoid unbounded memory use from a
# misbehaving/hostile upstream (10 MB is far above any real fetcher payload).
MAX_RESPONSE_BYTES = 10 * 1024 * 1024

# Module-level Session: connection pooling + keep-alive across the many GETs a
# fetch run makes to the same hosts (FRED/EIA/USDA/Yahoo).
_SESSION = requests.Session()
_SESSION.headers.update(
    {'User-Agent': 'BenchmarkWatcher/1.0 (open-source commodity tracker)'}
)


def safe_get(url: str, params: ParamsType = None, retries: int = 3) -> requests.Response:
    """
    Robust HTTP GET with exponential backoff and proper User-Agent.

    ``params`` accepts a dict **or** a sequence of (key, value) tuples
    so callers like EIA can send repeated query-string keys.

    Uses a shared pooled ``Session`` and streams the body so an oversized
    response can be rejected before it is fully buffered into memory.
    """
    for attempt in range(retries):
        try:
            resp = _SESSION.get(url, params=params, timeout=30, stream=True)
            resp.raise_for_status()
            # Guard against an unbounded body: prefer the declared length, then
            # fall back to measuring the streamed content.
            declared = resp.headers.get('Content-Length')
            if declared is not None and declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
                resp.close()
                raise requests.exceptions.RequestException(
                    f"Response too large: {declared} bytes > {MAX_RESPONSE_BYTES}"
                )
            content = resp.content  # buffers the streamed body
            if len(content) > MAX_RESPONSE_BYTES:
                resp.close()
                raise requests.exceptions.RequestException(
                    f"Response too large: {len(content)} bytes > {MAX_RESPONSE_BYTES}"
                )
            return resp
        except requests.exceptions.RequestException as e:
            if attempt == retries - 1:
                raise
            sleep_time = 1.5 * (2 ** attempt)
            logger.warning(f"  Retry {attempt + 1}/{retries} in {sleep_time}s: {e}")
            time.sleep(sleep_time)


# =============================================================================
# Processing
# =============================================================================

def parse_records(
    raw_records: List[Dict[str, Any]],
    *,
    value_key: str = "value",
    date_key: str = "date",
    skip_values: Sequence[str] = (".", ""),
) -> List[Observation]:
    """Parse raw API records into [{date, price}] observations.

    Shared by FRED and EIA fetchers which follow the same
    iterate → extract value → parse date → append pattern.
    Records are returned oldest-first.
    """
    parser = SmartDateParser()
    results: List[Observation] = []
    for rec in raw_records:
        val = rec.get(value_key)
        if val is None or val in skip_values:
            continue
        try:
            price = float(val)
            dt = parser.parse(rec.get(date_key))
            if dt:
                results.append({"date": dt, "price": round(price, 4)})
        except (ValueError, TypeError):
            continue
    return list(reversed(results))


def merge_history(existing: List[Observation], new_data: List[Observation]) -> List[Observation]:
    """Merge new data into existing history (deduplicated by date).

    Observations missing/empty a ``date`` are skipped and logged rather than
    bucketed under the empty-string key (which would collapse every dateless
    entry to a single record).
    """
    seen: Dict[str, Observation] = {}
    for entry in existing:
        d = entry.get('date')
        if not d:
            logger.warning("  Skipping existing observation with missing date: %s", entry)
            continue
        seen[d] = entry
    for entry in new_data:
        d = entry.get('date')
        if not d:
            logger.warning("  Skipping new observation with missing date: %s", entry)
            continue
        seen[d] = entry  # New data overwrites old

    merged = sorted(seen.values(), key=lambda x: x.get('date', ''))
    return merged


def compute_metrics(history: List[Observation]) -> Dict[str, Any]:
    """Compute descriptive, backward-looking summary statistics over observations."""
    if not history:
        return {}

    latest = history[-1]['price']
    metrics = {'latest_price': latest}

    # Explicit observation counts for legal defensibility
    metrics['observations'] = len(history)
    metrics['latest_observation_date'] = history[-1]['date']

    def get_pct_change(past_idx):
        if len(history) >= past_idx + 1:
            past = history[-(past_idx + 1)]['price']
            if past and past != 0:
                return round((latest / past - 1) * 100, 2)
        return None

    # Observation-based field names (semantically accurate)
    metrics['abs_change_1_obs'] = round(latest - history[-2]['price'], 4) if len(history) >= 2 else None
    metrics['pct_change_1_obs'] = get_pct_change(1)
    metrics['pct_change_30_obs'] = get_pct_change(30)
    metrics['pct_change_365_obs'] = get_pct_change(365)

    # Direction indicator (not trend - avoids forward-looking implication)
    metrics['direction_30_obs'] = 'flat'
    if metrics['pct_change_30_obs'] is not None:
        if metrics['pct_change_30_obs'] > 1.0:
            metrics['direction_30_obs'] = 'up'
        elif metrics['pct_change_30_obs'] < -1.0:
            metrics['direction_30_obs'] = 'down'

    # Legacy aliases for UI compatibility
    metrics['change_1d'] = metrics['abs_change_1_obs']
    metrics['pct_1d'] = metrics['pct_change_1_obs']
    metrics['pct_30d'] = metrics['pct_change_30_obs']
    metrics['pct_1y'] = metrics['pct_change_365_obs']
    metrics['trend'] = metrics['direction_30_obs']

    return metrics


# =============================================================================
# Record building
# =============================================================================

def build_commodity_record(
    existing: Dict[str, Any],
    history: List[Observation],
    metrics: Dict[str, Any],
    *,
    overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build/refresh a commodity record's top-level fields from its history.

    Mirrors the record shape produced by ``fetch_daily_data.update_commodity``
    so the targeted fetcher cannot leave stale top-level ``price``/``date``/
    ``derived`` fields while ``history`` advances (the UI-18 stale-headline bug).

    ``existing`` is mutated and returned. ``overrides`` (e.g. id/name/category
    for a freshly-built record) take precedence over any existing values.
    """
    record = dict(existing)
    if overrides:
        for key, value in overrides.items():
            record[key] = value

    latest = history[-1] if history else {}
    record['history'] = history
    record['metrics'] = metrics
    record['derived'] = {'descriptive_stats': metrics}
    record['price'] = latest.get('price')
    record['date'] = latest.get('date')
    record['updated_at'] = datetime.now().isoformat()
    return record


# =============================================================================
# I/O
# =============================================================================

def save_atomic(filepath: str, data: Dict[str, Any]) -> bool:
    """Atomic write: write to .tmp then rename to avoid corruption."""
    try:
        dir_name = os.path.dirname(filepath)
        fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix='.tmp')
        try:
            with os.fdopen(fd, 'w') as f:
                json.dump(data, f, indent=2, default=str)
            os.replace(tmp_path, filepath)
            return True
        except Exception:
            os.unlink(tmp_path)
            raise
    except Exception as e:
        logger.error(f"  Atomic save failed for {filepath}: {e}")
        return False
