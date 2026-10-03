"""Public source catalog validation, discovery, and reference record creation."""

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from scripts.fetchers._shared import compute_metrics
from scripts.fetchers.global_reference import GLOBAL_FETCHERS, OfficialClient, SourceError

SCRIPT_DIR = Path(__file__).resolve().parent
REGISTRY_PATH = SCRIPT_DIR / "source_registry.json"
SERIES_PATH = SCRIPT_DIR / "global_series.json"
STATUSES = {"adapter_ready", "catalogued", "needs_registration", "access_review"}


def load_registry(path: Path = REGISTRY_PATH) -> Dict[str, Any]:
    registry = json.loads(path.read_text(encoding="utf-8"))
    validate_registry(registry)
    return registry


def validate_registry(registry: Dict[str, Any]) -> None:
    if registry.get("schema_version") != 1 or not isinstance(registry.get("sources"), list):
        raise SourceError("Unsupported source registry")
    seen = set()
    for source in registry["sources"]:
        identifier = source.get("id", "")
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,50}", identifier) or identifier in seen:
            raise SourceError("Duplicate or invalid source identifier")
        seen.add(identifier)
        if source.get("status") not in STATUSES:
            raise SourceError("Unknown source catalog status")
        for field in ("name", "region", "countries", "categories", "checked_on", "access", "reuse", "rate_limit"):
            if not source.get(field):
                raise SourceError("Source metadata is incomplete")
        for field in ("documentation_url", "api_base_url"):
            url = urlsplit(source.get(field, ""))
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise SourceError("Source links must be public HTTPS URLs")
        if source["access"].get("billing_enabled") is not False:
            raise SourceError("Billing must remain disabled in the public-source catalog")
        if source["status"] == "adapter_ready":
            if source.get("adapter") not in GLOBAL_FETCHERS:
                raise SourceError("Source has no reader implementation")
            if source["access"].get("cost_status") != "free_public" or source["access"].get("authentication") != "none":
                raise SourceError("Enabled readers must be verified no-key public sources")


def load_series(path: Path = SERIES_PATH) -> List[Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    sources = {source["id"]: source for source in load_registry()["sources"]}
    seen = set()
    for series in payload.get("series", []):
        identifier = series.get("id", "")
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,100}", identifier) or identifier in seen:
            raise SourceError("Duplicate or invalid reference identifier")
        seen.add(identifier)
        source = sources.get(series.get("source_id"))
        if source is None or source["status"] != "adapter_ready":
            raise SourceError("Reference series needs a ready reader")
        for field in ("name", "kind", "category", "countries", "unit", "currency", "frequency", "source_class", "date_semantics", "source_url", "attribution"):
            if not series.get(field):
                raise SourceError("Reference series metadata is incomplete")
    return payload["series"]


def registry_summary(registry: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    registry = registry or load_registry()
    sources = registry["sources"]
    return {"checked_on": registry["checked_on"], "catalogued_sources": len(sources),
            "reader_implementations": sum(source["status"] == "adapter_ready" for source in sources),
            "by_status": dict(Counter(source["status"] for source in sources)),
            "by_region": dict(Counter(source["region"] for source in sources)),
            "billing_enabled": False,
            "note": "Catalog entries are not automatically connected datasets or data coverage guarantees."}


def fetch_reference(series: Dict[str, Any], client: OfficialClient) -> Dict[str, Any]:
    source = next((source for source in load_registry()["sources"] if source["id"] == series["source_id"]), None)
    if not source or source["status"] != "adapter_ready":
        raise SourceError("Source reader is not enabled")
    parameters = {key: value for key, value in series["api_config"].items() if key != "provider"}
    history = GLOBAL_FETCHERS[source["adapter"]](client, **parameters)
    if not history:
        raise SourceError("Official series returned no usable observations; preserve the existing record")
    # ``price`` and ``history`` are schema compatibility fields; ``kind`` and
    # ``unit`` distinguish exchange/statistical values from commodity prices.
    record = {key: series[key] for key in ("id", "name", "category", "kind", "reference_type", "countries", "unit", "currency", "frequency", "source_class", "date_semantics", "source_url", "attribution")}
    record.update({"source_id": source["id"], "source_name": source["name"],
                   "source_type": "GLOBAL_REFERENCE", "simulated": False,
                   "price": history[-1]["price"], "date": history[-1]["date"],
                   "period": history[-1]["period"], "history": history,
                   "metrics": compute_metrics(history),
                   "source_checked_on": source["checked_on"],
                   "fetched_at": datetime.now(timezone.utc).isoformat(),
                   "updated_at": datetime.now(timezone.utc).isoformat(),
                   "calculations_note": "Descriptive changes are calculated by BenchmarkWatcher; source observations are unchanged."})
    return record


def _wb_page(payload: Any) -> tuple:
    if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[0], dict) or not isinstance(payload[1], list):
        raise SourceError("World Bank catalog response is invalid")
    return payload[0], payload[1]


def discover_worldbank(client: OfficialClient, max_pages: int = 3) -> Dict[str, Any]:
    """Discover economy/indicator metadata, never query every combination."""
    if not 1 <= max_pages <= 5:
        raise SourceError("Catalog pages must be between 1 and 5")
    meta, country_rows = _wb_page(client.get_json("https://api.worldbank.org/v2/country",
                                                {"format": "json", "per_page": 400}))
    if int(meta.get("pages", 0)) != 1:
        raise SourceError("Country catalog exceeded its page budget")
    economies, aggregates = [], []
    for row in country_rows:
        item = {"id": row["id"], "iso2": row["iso2Code"], "name": row["name"],
                "region": row.get("region", {}).get("value", "").strip()}
        (aggregates if row.get("region", {}).get("id") == "NA" else economies).append(item)
    indicators = []
    total = 0
    for page in range(1, max_pages + 1):
        meta, rows = _wb_page(client.get_json("https://api.worldbank.org/v2/indicator",
                                            {"format": "json", "source": 2, "per_page": 1000, "page": page}))
        total = int(meta.get("total", 0))
        for row in rows:
            indicators.append({"id": row["id"], "name": row["name"], "unit": row.get("unit", ""),
                               "description": row.get("sourceNote", ""),
                               "original_source": row.get("sourceOrganization", ""),
                               "topics": [topic["value"].strip() for topic in row.get("topics", [])],
                               "status": "catalogued", "redistribution_review": "Check indicator metadata and original-source terms before enabling.",
                               "source_url": "https://data.worldbank.org/indicator/" + row["id"]})
        if page >= int(meta.get("pages", 0)):
            break
    # Aggregate regions are not reported as countries.
    return {"source_id": "worldbank", "economies": economies, "aggregates": aggregates,
            "indicators": indicators, "provider_reported_indicators": total,
            "complete": len(indicators) == total, "economies_count": len(economies),
            "indicator_count": len(indicators), "observation_series_connected": 0,
            "documentation_url": "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
            "terms_url": "https://data.worldbank.org/summary-terms-of-use"}


def discover_bank_canada(client: OfficialClient) -> Dict[str, Any]:
    payload = client.get_json("https://www.bankofcanada.ca/valet/lists/series/json")
    if not isinstance(payload, dict) or not isinstance(payload.get("series"), dict):
        raise SourceError("Bank of Canada catalog response is invalid")
    items = [{"id": identifier, "name": value.get("label", identifier),
              "description": value.get("description", ""), "status": "catalogued",
              "source_url": "https://www.bankofcanada.ca/valet/series/" + identifier}
             for identifier, value in sorted(payload["series"].items())]
    return {"source_id": "bank_canada", "series": items, "series_count": len(items),
            "observation_series_connected": 0, "terms_url": "https://www.bankofcanada.ca/terms/"}


def discover_imf(client: OfficialClient) -> Dict[str, Any]:
    base = "https://www.imf.org/external/datamapper/api/v2/"
    countries = client.get_json(base + "countries").get("countries")
    indicators = client.get_json(base + "indicators").get("indicators")
    if not isinstance(countries, dict) or not isinstance(indicators, dict):
        raise SourceError("IMF DataMapper catalog response is invalid")
    return {"source_id": "imf_datamapper", "country_count": len(countries),
            "countries": [{"id": key, "name": value.get("label", key)} for key, value in sorted(countries.items())],
            "indicators": [{"id": key, "name": value.get("label", key), "unit": value.get("unit", ""),
                            "status": "catalogued", "may_include_estimates_or_forecasts": True}
                           for key, value in sorted(indicators.items())],
            "indicator_count": len(indicators), "observation_series_connected": 0,
            "documentation_url": "https://www.imf.org/external/datamapper/api/help"}


CATALOG_DISCOVERY = {"worldbank": discover_worldbank, "bank_canada": discover_bank_canada,
                     "imf_datamapper": discover_imf}
