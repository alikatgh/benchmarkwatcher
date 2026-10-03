"""Public source catalog validation, discovery, and reference record creation."""

import json
import math
import re
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from scripts.fetchers._shared import compute_metrics, merge_history, save_atomic
from scripts.fetchers.global_reference import GLOBAL_FETCHERS, OfficialClient, SourceError, fetch_worldbank_bulk

SCRIPT_DIR = Path(__file__).resolve().parent
REGISTRY_PATH = SCRIPT_DIR / "source_registry.json"
SERIES_PATH = SCRIPT_DIR / "global_series.json"
BULK_PATH = SCRIPT_DIR / "worldbank_bulk_series.json"
BULK_MANIFEST = "worldbank_manifest.json"
STATUSES = {"adapter_ready", "catalogued", "needs_registration", "access_review"}
WORLD_BANK_DEFINITION_FIELDS = ('id', 'name', 'category', 'kind', 'economy_id', 'countries', 'indicator',
                                'unit', 'currency', 'source_id', 'source_name', 'source_class', 'source_url',
                                'source_type', 'reference_type', 'frequency', 'date_semantics', 'api_config',
                                'license', 'license_evidence_url', 'original_source', 'attribution')
REFERENCE_OBSERVATION_FIELDS = ('date', 'price', 'period', 'status', 'footnote', 'source_decimal')


def load_worldbank_bulk(path: Path = BULK_PATH) -> Dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    if (config.get("schema_version") != 1 or config.get("source_id") != "worldbank"
            or config.get("source_database") != 2 or not isinstance(config.get("indicators"), list)
            or not 1 <= len(config["indicators"]) <= 6):
        raise SourceError("Unsupported World Bank bulk configuration")
    seen = set()
    for item in config["indicators"]:
        code = item.get("indicator", "")
        if (not re.fullmatch(r"[A-Z][A-Z0-9_.]{1,80}", code) or code in seen
                or not re.fullmatch(r"[a-z][a-z0-9_]{1,35}", item.get("slug", ""))
                or item.get("license") != "CC BY-4.0"
                or item.get("license_evidence_url") != "https://data.worldbank.org/indicator/" + code
                or item.get("reference_type") not in {"consumer_inflation", "economic_indicator"}
                or any(not item.get(field) for field in ("name", "unit", "currency", "original_source", "checked_on"))):
            raise SourceError("Bulk indicators require reviewed identity, units and reuse evidence")
        seen.add(code)
    return config


def worldbank_definition(indicator: Dict[str, Any], economy: Dict[str, str],
                         aliases: Optional[Dict[tuple, str]] = None) -> Dict[str, Any]:
    """Derive trusted public metadata, preserving previously published IDs."""
    identifier = (aliases or {}).get((economy["iso2"], indicator["indicator"]),
                                     "wb_" + economy["id"].lower() + "_" + indicator["slug"])
    return {"id": identifier, "name": economy["name"] + " · " + indicator["name"],
            "category": "index", "kind": "national_accounts" if indicator["currency"] != "COUNT" else "population",
            "reference_type": indicator["reference_type"], "countries": [economy["iso2"]],
            "economy_id": economy["id"], "economy_name": economy["name"], "region": economy["region"],
            "indicator": indicator["indicator"], "indicator_name": indicator["name"],
            "unit": indicator["unit"], "currency": indicator["currency"], "frequency": "annual",
            "source_class": "official_statistic", "date_semantics": "period_start", "enabled": True,
            "source_id": "worldbank", "source_name": "World Bank Indicators", "source_type": "GLOBAL_REFERENCE",
            "source_url": indicator["license_evidence_url"] + "?locations=" + economy["iso2"],
            "license": indicator["license"], "license_evidence_url": indicator["license_evidence_url"],
            "original_source": indicator["original_source"],
            "attribution": "The World Bank: World Development Indicators: " + indicator["original_source"],
            "source_checked_on": indicator["checked_on"],
            "api_config": {"provider": "worldbank", "country": economy["iso2"], "indicator": indicator["indicator"]}}


def merge_reference_history(existing: Dict[str, Any], new_data: List[Dict[str, Any]],
                             checked_at: str) -> tuple:
    previous = {point["date"]: point for point in existing.get("history", []) if point.get("date")}
    revisions = list(existing.get("revisions", []))
    replacements = []
    for point in new_data:
        old = previous.get(point.get("date"))
        # Provider fields are authoritative, including removed flags. Operator
        # annotations are independent and survive re-reading the same period.
        replacement = {key: value for key, value in (old or {}).items()
                       if key not in REFERENCE_OBSERVATION_FIELDS}
        replacement.update(point)
        if old is not None and any(old.get(key) != point.get(key) for key in REFERENCE_OBSERVATION_FIELDS):
            revisions.append({"date": point["date"], "previous": dict(old), "replacement": dict(replacement),
                              "previous_fetched_at": existing.get("fetched_at"), "checked_at": checked_at})
        replacements.append(replacement)
    return merge_history(existing.get("history", []), replacements), revisions


def validate_worldbank_archive(existing: Dict[str, Any], definition: Dict[str, Any],
                               legacy_definition: Optional[Dict[str, Any]] = None) -> None:
    """Never relabel incompatible observations as an official country series.

    Only the six previously published agriculture IDs may omit definition
    fields. Present fields must match their published schema or the new one.
    New country IDs require the complete reviewed definition.
    """
    for key in WORLD_BANK_DEFINITION_FIELDS:
        if legacy_definition is not None and key not in existing:
            continue
        if existing.get(key) == definition[key]:
            continue
        if legacy_definition is not None and key in legacy_definition and existing.get(key) == legacy_definition[key]:
            continue
        raise SourceError("Existing country history has conflicting identity or units; preserve it")


def _archive(path: Path, identifier: Optional[str] = None) -> Dict[str, Any]:
    if path.is_symlink() or path.parent.is_symlink():
        raise SourceError("Do not replace a symlinked reference archive")
    if not path.exists():
        return {}
    if not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
        raise SourceError("Existing reference archive is oversized or not a regular file")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SourceError("Existing reference archive is unreadable; preserve it") from exc
    if not isinstance(payload, dict) or identifier and payload.get("id") not in (None, identifier):
        raise SourceError("Existing reference archive has a different identity")
    if identifier and (not isinstance(payload.get("history", []), list) or not isinstance(payload.get("revisions", []), list)):
        raise SourceError("Existing reference archive has invalid history; preserve it")
    if identifier and any(not isinstance(row, dict) or not isinstance(row.get("date"), str) or
                          isinstance(row.get("price"), bool) or not isinstance(row.get("price"), (int, float)) or
                          not math.isfinite(row["price"]) for row in payload.get("history", [])):
        raise SourceError("Existing reference archive has invalid observations; preserve it")
    return payload


def update_worldbank_bulk(client: OfficialClient, directory: Path,
                          config: Optional[Dict[str, Any]] = None,
                          snapshot: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Six bulk reads, then save nonempty economy histories and a small index.

    A failed indicator preserves its existing records and manifest entries. The
    index lists only records that were saved successfully; it never pretends
    that every discovered indicator is connected.
    """
    config = config or load_worldbank_bulk()
    snapshot = snapshot or json.loads((SCRIPT_DIR / "global_catalog_snapshot.json").read_text())
    worldbank = snapshot["worldbank"]
    directory = Path(directory)
    if directory.is_symlink():
        raise SourceError("Do not write through a symlinked reference directory")
    directory.mkdir(parents=True, exist_ok=True)
    manifest_path = directory / BULK_MANIFEST
    previous_manifest = _archive(manifest_path)
    if previous_manifest and (previous_manifest.get("schema_version") != 1 or
                              previous_manifest.get("source_id") != "worldbank" or
                              not isinstance(previous_manifest.get("series"), list) or
                              any(not isinstance(row, dict) or not all(key in row for key in
                                  ("id", "economy_id", "indicator", "observation_count")) for row in previous_manifest["series"])):
        raise SourceError("Existing bulk index is invalid; preserve it")
    entries = {row["id"]: row for row in previous_manifest.get("series", [])}
    legacy_definitions = {row['id']: row for row in load_series()
                          if row.get('enabled') and row['source_id'] == 'worldbank'}
    aliases = {(row["api_config"]["country"], row["api_config"]["indicator"]): row["id"]
               for row in legacy_definitions.values()}
    economies = {row["id"]: row for row in worldbank["economies"]}
    stamp = datetime.now(timezone.utc).isoformat()
    end = date.today().year - 1
    start = max(config["start_year"], end - 29)
    results = []
    before_requests = client.request_count
    for indicator in config["indicators"]:
        if indicator.get("enabled") is not True:
            continue
        try:
            histories = fetch_worldbank_bulk(client, indicator["indicator"], worldbank["economies"],
                                               worldbank["aggregates"], start, end)
            if not histories:
                raise SourceError("No nonempty economy histories returned; existing records preserved")
            saved, observations = 0, 0
            for iso3, history in sorted(histories.items()):
                definition = worldbank_definition(indicator, economies[iso3], aliases)
                path = directory / (definition["id"] + ".json")
                existing = _archive(path, definition["id"])
                if existing:
                    validate_worldbank_archive(existing, definition, legacy_definitions.get(definition['id']))
                merged, revisions = merge_reference_history(existing, history, stamp)
                record = dict(existing)
                record.update(definition)
                record.update({"history": merged, "revisions": revisions, "simulated": False,
                               "price": merged[-1]["price"], "date": merged[-1]["date"],
                               "period": merged[-1]["period"], "fetched_at": stamp, "updated_at": stamp,
                               "metrics": compute_metrics(merged),
                               "calculations_note": "Descriptive changes are calculated by BenchmarkWatcher; source observations are unchanged."})
                if not save_atomic(str(path), record):
                    raise SourceError("An economy history could not be saved; its previous record is preserved")
                entries[definition["id"]] = {"id": definition["id"], "economy_id": iso3,
                                             "indicator": indicator["indicator"], "latest": merged[-1],
                                             "observation_count": len(merged), "checked_on": stamp[:10]}
                saved += 1
                observations += len(merged)
            results.append({"indicator": indicator["indicator"], "status": "fetched",
                            "economies": saved, "observations": observations})
        except (SourceError, OSError, ValueError, TypeError, KeyError) as exc:
            results.append({"indicator": indicator["indicator"], "status": "failed", "reason": str(exc)[:200]})
    rows = sorted(entries.values(), key=lambda row: (row["economy_id"], row["indicator"]))
    manifest = {"schema_version": 1, "source_id": "worldbank", "source_database": 2,
                "checked_on": stamp[:10], "start_year": start, "end_year": end,
                "series_count": len(rows), "economies_count": len({row["economy_id"] for row in rows}),
                "indicator_count": len({row["indicator"] for row in rows}),
                "observation_count": sum(row["observation_count"] for row in rows),
                "series": rows, "results": results, "billing_enabled": False}
    if not save_atomic(str(manifest_path), manifest):
        raise SourceError("Bulk index could not be saved; previous index preserved")
    return {"requests_made": client.request_count - before_requests, "billing_enabled": False,
            "series_count": manifest["series_count"], "economies_count": manifest["economies_count"],
            "indicator_count": manifest["indicator_count"], "observation_count": manifest["observation_count"],
            "results": results}


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
