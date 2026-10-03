#!/usr/bin/env python3
"""Fetch explicitly selected official series into a separate staging folder."""

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.fetchers._shared import save_atomic
from scripts.fetchers.global_reference import OfficialClient, SourceError
from scripts.global_sources import fetch_reference, load_series


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--series", nargs="+", help="Explicit configured series IDs; no wildcard fanout")
    parser.add_argument("--output-dir", type=Path, help="Separate staging folder; production data is not modified by default")
    parser.add_argument("--list", action="store_true", help="List configured series without network requests")
    parser.add_argument("--max-requests", type=int, default=20)
    args = parser.parse_args(argv)
    available = {series["id"]: series for series in load_series() if series.get("enabled")}
    if args.list:
        print(json.dumps([{key: value[key] for key in ("id", "name", "source_id", "kind", "countries", "unit")}
                          for value in available.values()], indent=2))
        return 0
    if not args.series or args.output_dir is None:
        parser.error("--series and --output-dir are required to make requests")
    selected = list(dict.fromkeys(args.series))
    if len(selected) > 25 or any(identifier not in available for identifier in selected):
        parser.error("Choose at most 25 configured series IDs from --list")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    client = OfficialClient(max_requests=args.max_requests)
    results = []
    try:
        for identifier in selected:
            try:
                record = fetch_reference(available[identifier], client)
                if not save_atomic(str(args.output_dir / (identifier + ".json")), record):
                    raise SourceError("Staged record could not be saved; existing record preserved")
                results.append({"id": identifier, "status": "fetched", "observations": len(record["history"]),
                                "period": record["period"], "kind": record["kind"]})
            except (SourceError, ValueError, KeyError, TypeError) as exc:
                results.append({"id": identifier, "status": "failed", "reason": str(exc)[:200]})
    finally:
        client.close()
    print(json.dumps({"requests_made": client.request_count, "billing_enabled": False, "results": results}, indent=2))
    return 1 if any(result["status"] == "failed" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
