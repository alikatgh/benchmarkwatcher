#!/usr/bin/env python3
"""Audit catalog metadata; optional explicit discovery/probe makes bounded GETs."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.fetchers._shared import save_atomic
from scripts.fetchers.global_reference import OfficialClient, SourceError
from scripts.global_sources import (CATALOG_DISCOVERY, fetch_reference, load_series,
                                    registry_summary)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover", nargs="+", choices=sorted(CATALOG_DISCOVERY))
    parser.add_argument("--probe", nargs="+", help="Read selected configured series without saving observations")
    parser.add_argument("--output", type=Path, help="Save public catalog/probe report; requires an explicit destination")
    parser.add_argument("--max-requests", type=int, default=12)
    args = parser.parse_args(argv)
    report = {"registry": registry_summary(), "checked_at": datetime.now(timezone.utc).isoformat(),
              "catalogs": [], "probes": [], "failures": []}
    if not args.discover and not args.probe:
        print(json.dumps(report["registry"], indent=2))
        return 0
    selected = list(dict.fromkeys(args.probe or []))
    available = {series["id"]: series for series in load_series()}
    if len(selected) > 10 or any(identifier not in available for identifier in selected):
        parser.error("Probe at most 10 configured series IDs listed by fetch_global_sources.py --list")
    client = OfficialClient(max_requests=args.max_requests)
    try:
        for identifier in dict.fromkeys(args.discover or []):
            try:
                report["catalogs"].append(CATALOG_DISCOVERY[identifier](client))
            except (SourceError, ValueError, KeyError, TypeError) as exc:
                report["failures"].append({"source_id": identifier, "reason": str(exc)[:200]})
        for identifier in selected:
            try:
                series = dict(available[identifier])
                series["api_config"] = dict(series["api_config"])
                if "limit" in series["api_config"]:
                    series["api_config"]["limit"] = 3
                record = fetch_reference(series, client)
                report["probes"].append({"id": identifier, "status": "verified", "observations": len(record["history"]),
                                         "latest_period": record["period"], "kind": record["kind"],
                                         "unit": record["unit"], "source_url": record["source_url"]})
            except (SourceError, ValueError, KeyError, TypeError) as exc:
                report["failures"].append({"id": identifier, "reason": str(exc)[:200]})
    finally:
        client.close()
    report["requests_made"] = client.request_count
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        save_atomic(str(args.output), report)
    # Avoid printing thousands of metadata rows or upstream errors in the log.
    summary = {"registry": report["registry"], "requests_made": report["requests_made"],
               "catalogs": [{key: value for key, value in catalog.items() if key.endswith("count") or key in ("source_id", "complete")}
                            for catalog in report["catalogs"]],
               "probes": report["probes"], "failures": report["failures"]}
    print(json.dumps(summary, indent=2))
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
