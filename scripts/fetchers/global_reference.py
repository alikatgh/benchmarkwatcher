"""Bounded, no-key readers for official international reference statistics.

These readers make one request, never retry automatically, and never fill gaps.
Monthly/annual periods retain their original period labels. ``date`` is the
period start for those frequencies, not a claimed publication date.
"""

import csv
import io
import json
import logging
import math
import re
import time
from datetime import date
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import requests

Observation = Dict[str, Any]
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_OBSERVATIONS = 5000
TIMEOUT = (5, 25)
ALLOWED_PATHS = {
    "data-api.ecb.europa.eu": ("/service/data/EXR/",),
    "www.bankofcanada.ca": ("/valet/observations/", "/valet/lists/series/json"),
    "ec.europa.eu": ("/eurostat/api/dissemination/statistics/1.0/data/",),
    "api.worldbank.org": ("/v2/country", "/v2/indicator"),
    "www.imf.org": ("/external/datamapper/api/v2/",),
    "storage.data.gov.my": ("/commodities/fuelprice.csv",),
}


class SourceError(ValueError):
    """The official service or its response did not meet the reader contract."""


class OfficialClient:
    """GET-only transport with a request budget, host pacing, and body cap.

    A client is created per command, not a hidden global background service.
    No credentials, payment configuration, proxy secrets, or cookies are used.
    """

    def __init__(self, max_requests: int = 20, min_interval: float = 1.0):
        if not 1 <= max_requests <= 30:
            raise SourceError("Request budget must be between 1 and 30")
        self.max_requests = max_requests
        self.request_count = 0
        self.min_interval = max(1.0, min_interval)
        self._last_request: Dict[str, float] = {}
        self._cache: Dict[str, str] = {}
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers.update({"User-Agent": "BenchmarkWatcher/1.0 (public reference data; cached reads)"})

    def close(self) -> None:
        self.session.close()

    def get_text(self, url: str, params: Optional[Dict[str, Any]] = None) -> str:
        parsed = urlsplit(url)
        allowed = ALLOWED_PATHS.get(parsed.hostname or "", ())
        if (parsed.scheme != "https" or parsed.username or parsed.password or
                parsed.port not in (None, 443) or parsed.query or parsed.fragment or
                not any(parsed.path.startswith(prefix) for prefix in allowed)):
            raise SourceError("Only allowlisted official HTTPS endpoints may be requested")
        cache_key = url + json.dumps(params or {}, sort_keys=True)
        if cache_key in self._cache:
            return self._cache[cache_key]
        if self.request_count >= self.max_requests:
            raise SourceError("Request budget exhausted")
        host = parsed.hostname or ""
        elapsed = time.monotonic() - self._last_request.get(host, 0.0)
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self.request_count += 1
        self._last_request[host] = time.monotonic()
        response = None
        try:
            response = self.session.get(url, params=params, timeout=TIMEOUT,
                                        stream=True, allow_redirects=False)
            if 300 <= response.status_code < 400:
                raise SourceError("Official endpoint redirected; review its new URL before use")
            response.raise_for_status()
            length = response.headers.get("Content-Length", "")
            if length.isdigit() and int(length) > MAX_RESPONSE_BYTES:
                raise SourceError("Official response exceeds the body limit")
            chunks = []
            size = 0
            for chunk in response.iter_content(chunk_size=16384):
                size += len(chunk)
                if size > MAX_RESPONSE_BYTES:
                    raise SourceError("Official response exceeds the body limit")
                chunks.append(chunk)
            result = b"".join(chunks).decode("utf-8-sig")
            self._cache[cache_key] = result
            return result
        except requests.RequestException as exc:
            # Deliberately do not echo the URL, response body, or environment.
            raise SourceError("Official request failed (%s)" % type(exc).__name__) from exc
        finally:
            if response is not None:
                response.close()

    def get_json(self, url: str, params: Optional[Dict[str, Any]] = None) -> Any:
        try:
            return json.loads(self.get_text(url, params))
        except (json.JSONDecodeError, UnicodeError) as exc:
            raise SourceError("Official response is not valid UTF-8 JSON") from exc


def _code(value: str, pattern: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise SourceError("Invalid series identifier")
    return value


def _limit(value: int, maximum: int = MAX_OBSERVATIONS) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise SourceError("Observation limit is outside its allowed range")
    return value


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def period_date(period: str) -> Tuple[str, str]:
    """Return an honest plotting date and its unaltered source period."""
    if not isinstance(period, str):
        raise SourceError("Missing observation period")
    if re.fullmatch(r"\d{4}", period):
        plotted = period + "-01-01"
    elif re.fullmatch(r"\d{4}-\d{2}", period):
        plotted = period + "-01"
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", period):
        plotted = period
    else:
        raise SourceError("Unsupported observation period")
    date.fromisoformat(plotted)
    return plotted, period


def _point(period: str, value: Any, status: Any = None) -> Optional[Observation]:
    number = _number(value)
    if number is None:
        return None
    try:
        plotted, original = period_date(period)
    except (ValueError, TypeError):
        return None
    result: Observation = {"date": plotted, "period": original, "price": number}
    if status:
        result["status"] = str(status)
    return result


def _sorted(points: List[Observation]) -> List[Observation]:
    if len(points) > MAX_OBSERVATIONS:
        raise SourceError("Response contains too many observations")
    seen = {p["date"]: p for p in points}
    return sorted(seen.values(), key=lambda point: point["date"])


def parse_ecb_csv(text: str, currency: str) -> List[Observation]:
    rows = csv.DictReader(io.StringIO(text))
    expected = {"TIME_PERIOD", "OBS_VALUE", "CURRENCY", "CURRENCY_DENOM", "UNIT_MULT", "FREQ"}
    if not expected.issubset(rows.fieldnames or ()):
        raise SourceError("ECB CSV columns changed")
    points = []
    for row in rows:
        if (row.get("CURRENCY") != currency or row.get("CURRENCY_DENOM") != "EUR" or
                row.get("UNIT_MULT") != "0" or row.get("FREQ") != "D"):
            raise SourceError("ECB series identity or units changed")
        point = _point(row["TIME_PERIOD"], row["OBS_VALUE"], row.get("OBS_STATUS"))
        if point is not None:
            points.append(point)
    return _sorted(points)


def fetch_ecb_exchange(client: OfficialClient, currency: str = "USD", limit: int = 1250) -> List[Observation]:
    currency = _code(currency, r"[A-Z]{3}")
    text = client.get_text("https://data-api.ecb.europa.eu/service/data/EXR/D.%s.EUR.SP00.A" % currency,
                           {"format": "csvdata", "lastNObservations": _limit(limit)})
    return parse_ecb_csv(text, currency)


def parse_valet_json(payload: Any, series_id: str) -> List[Observation]:
    if (not isinstance(payload, dict) or not isinstance(payload.get("seriesDetail"), dict) or
            series_id not in payload["seriesDetail"]):
        raise SourceError("Bank of Canada response has no requested series")
    observations = payload.get("observations")
    if not isinstance(observations, list):
        raise SourceError("Bank of Canada observations are missing")
    points = []
    for row in observations:
        if not isinstance(row, dict):
            raise SourceError("Bank of Canada observation is invalid")
        value = row.get(series_id)
        if value is not None and not isinstance(value, dict):
            raise SourceError("Bank of Canada observation value is invalid")
        point = _point(row.get("d"), (value or {}).get("v"))
        if point is not None:
            points.append(point)
    return _sorted(points)


def fetch_bank_canada(client: OfficialClient, series_id: str, limit: int = 1250) -> List[Observation]:
    series_id = _code(series_id, r"[A-Za-z0-9_.-]{1,80}")
    payload = client.get_json("https://www.bankofcanada.ca/valet/observations/%s/json" % series_id,
                              {"recent": _limit(limit)})
    return parse_valet_json(payload, series_id)


def parse_eurostat_json(payload: Any, selections: Dict[str, str]) -> List[Observation]:
    """Read one JSON-stat series; refuse accidental multi-country/unit cubes."""
    if not isinstance(payload, dict) or payload.get("class") != "dataset":
        raise SourceError("Eurostat response is not a JSON-stat dataset")
    ids, sizes = payload.get("id", []), payload.get("size", [])
    if (not isinstance(ids, list) or not isinstance(sizes, list) or
            any(not isinstance(identifier, str) for identifier in ids) or
            len(ids) != len(sizes) or len(set(ids)) != len(ids) or set(ids) != set(selections) | {"time"} or
            any(not isinstance(size, int) or size < 1 for size in sizes)):
        raise SourceError("Eurostat dimensions are missing or invalid")
    dimensions = payload.get("dimension")
    if not isinstance(dimensions, dict):
        raise SourceError("Eurostat dimension metadata is invalid")
    indexes = {}
    for identifier in ids:
        dimension = dimensions.get(identifier)
        if not isinstance(dimension, dict) or not isinstance(dimension.get("category"), dict):
            raise SourceError("Eurostat dimension metadata is invalid")
        indexes[identifier] = dimension["category"].get("index")
    for identifier, size in zip(ids, sizes):
        if identifier != "time":
            index = indexes[identifier]
            if size != 1 or index != {selections.get(identifier): 0}:
                raise SourceError("Eurostat returned an unselected or multiple series")
    times = indexes["time"]
    if isinstance(times, list):
        times = {period: index for index, period in enumerate(times)}
    if not isinstance(times, dict) or len(times) != sizes[ids.index("time")]:
        raise SourceError("Eurostat time dimension changed")
    values = payload.get("value", {})
    statuses = payload.get("status", {})
    points = []
    for period, offset in times.items():
        if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset < len(times):
            raise SourceError("Eurostat time offset is invalid")
        value = values[offset] if isinstance(values, list) and offset < len(values) else values.get(str(offset)) if isinstance(values, dict) else None
        status = statuses[offset] if isinstance(statuses, list) and offset < len(statuses) else statuses.get(str(offset)) if isinstance(statuses, dict) else None
        point = _point(period, value, status)
        if point is not None:
            points.append(point)
    return _sorted(points)


def fetch_eurostat_hicp(client: OfficialClient, country: str, limit: int = 120) -> List[Observation]:
    country = _code(country, r"[A-Z]{2}")
    # ECOICOP 2 replaced the archived prc_hicp_manr/CP00 schema in 2026.
    selections = {"freq": "M", "unit": "RCH_A", "coicop18": "TOTAL", "geo": country}
    payload = client.get_json("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr",
                              {"lang": "EN", **selections, "lastTimePeriod": _limit(limit, 600)})
    return parse_eurostat_json(payload, selections)


def parse_worldbank_json(payload: Any, country: str, indicator: str) -> List[Observation]:
    if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[0], dict):
        raise SourceError("World Bank response is not an observation page")
    if int(payload[0].get("pages", 0)) > 1:
        raise SourceError("World Bank response is paginated; narrow its year range")
    if payload[1] is None:
        return []
    if not isinstance(payload[1], list):
        raise SourceError("World Bank observations are missing")
    points = []
    for row in payload[1]:
        if (not isinstance(row, dict) or not isinstance(row.get("indicator"), dict) or
                not isinstance(row.get("country"), dict)):
            raise SourceError("World Bank observation metadata is invalid")
        if row.get("indicator", {}).get("id") != indicator or row.get("country", {}).get("id") != country:
            raise SourceError("World Bank returned a different country or indicator")
        point = _point(row.get("date"), row.get("value"), row.get("obs_status"))
        if point is not None:
            points.append(point)
    return _sorted(points)


def fetch_worldbank_indicator(client: OfficialClient, country: str, indicator: str,
                             start_year: int = 2000, end_year: Optional[int] = None) -> List[Observation]:
    country = _code(country, r"[A-Z]{2}")
    indicator = _code(indicator, r"[A-Z0-9_.]{3,80}")
    end_year = end_year if end_year is not None else date.today().year - 1
    if (isinstance(start_year, bool) or isinstance(end_year, bool) or
            not isinstance(start_year, int) or not isinstance(end_year, int) or
            not 1960 <= start_year <= end_year < date.today().year or end_year - start_year > 100):
        raise SourceError("World Bank year range must be historical and at most 100 years")
    payload = client.get_json("https://api.worldbank.org/v2/country/%s/indicator/%s" % (country, indicator),
                              {"format": "json", "date": "%s:%s" % (start_year, end_year), "per_page": 101})
    return parse_worldbank_json(payload, country, indicator)


def parse_malaysia_fuel_csv(text: str, column: str) -> List[Observation]:
    rows = csv.DictReader(io.StringIO(text))
    if not {"date", "series_type", column}.issubset(rows.fieldnames or ()):
        raise SourceError("Malaysia fuel CSV columns changed")
    points = []
    for row in rows:
        # The CSV contains both absolute levels and weekly changes, with the
        # same dates/products. Never let change rows overwrite price levels.
        if row["series_type"] != "level":
            continue
        # Preserve nulls as gaps; do not borrow subsidised/other-region prices.
        point = _point(row["date"], row[column])
        if point is not None:
            if point['price'] < 0:
                raise SourceError("Malaysia fuel price level is negative")
            points.append(point)
    return _sorted(points)


def fetch_malaysia_fuel(client: OfficialClient, column: str = "ron97", limit: int = 1250,
                        series_type: str = "level") -> List[Observation]:
    if column not in {"ron95", "ron97", "diesel", "diesel_eastmsia"}:
        raise SourceError("Unsupported Malaysian fuel product")
    if series_type != "level":
        raise SourceError("Only published Malaysia fuel price levels are configured")
    text = client.get_text("https://storage.data.gov.my/commodities/fuelprice.csv")
    return parse_malaysia_fuel_csv(text, column)[-_limit(limit):]


GLOBAL_FETCHERS = {
    "ecb": fetch_ecb_exchange,
    "bank_canada": fetch_bank_canada,
    "eurostat": fetch_eurostat_hicp,
    "worldbank": fetch_worldbank_indicator,
    "malaysia": fetch_malaysia_fuel,
}


def fetch_global_reference(provider: str, client: Optional[OfficialClient] = None,
                           **parameters: Any) -> Optional[List[Observation]]:
    """Compatibility hook for the existing daily-fetch registry.

    Unknown providers and failed/no-data requests do not overwrite saved data.
    Each explicitly configured series gets a single no-key official request.
    The daily job can pass one batch client to share its request budget/cache.
    """
    fetcher = GLOBAL_FETCHERS.get(provider)
    if fetcher is None:
        logging.getLogger(__name__).warning("Unknown global reference provider")
        return None
    owns_client = client is None
    client = client or OfficialClient(max_requests=1)
    try:
        return fetcher(client, **parameters) or None
    except (SourceError, ValueError, KeyError, TypeError) as exc:
        logging.getLogger(__name__).warning("Global reference unavailable: %s", type(exc).__name__)
        return None
    finally:
        if owns_client:
            client.close()
