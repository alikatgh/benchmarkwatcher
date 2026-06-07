"""Re-sync each data/<id>.json's top-level price/date + derived metrics with its
own (possibly-grown) history, using the canonical compute_metrics().

Why this exists (UI-18): a file's history can be appended without recomputing the
derived block, leaving a STALE headline. e.g. gold.json had top-level
price=4490.3/2026-01-09 and derived.descriptive_stats.observations=730, while its
history actually runs daily to 5274.70/2026-02-27 (969 obs). The index recomputes
display from history[-1] so the grid showed 5274, but the detail page reads the
file's pre-computed fields and showed the stale 4490 — older than its own chart.

This mirrors fetch_daily_data.py's record assembly exactly (price/date = history[-1];
`metrics` and `derived.descriptive_stats` = compute_metrics(history)), so the only
thing it changes is freshness. Idempotent: writes a file only when it's stale.

Does NOT catch: a wrong/short history (it trusts the history as-is) — that's the
fetcher's job. Run from project root:  venv/bin/python scripts/resync_derived.py
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.fetchers._shared import compute_metrics  # noqa: E402


def resync_file(path):
    with open(path, 'r') as f:
        d = json.load(f)
    history = d.get('history') or []
    if not history:
        return None
    metrics = compute_metrics(history)
    latest = history[-1]
    cur_obs = (d.get('derived') or {}).get('descriptive_stats', {}).get('observations')
    stale = (
        d.get('price') != latest['price']
        or d.get('date') != latest['date']
        or cur_obs != metrics.get('observations')
    )
    if not stale:
        return None
    before = (d.get('price'), d.get('date'), cur_obs)
    d['price'] = latest['price']
    d['date'] = latest['date']
    d['metrics'] = metrics
    d['derived'] = {'descriptive_stats': metrics}
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(d, f, indent=2, default=str)
    os.replace(tmp, path)
    return before, (latest['price'], latest['date'], metrics.get('observations'))


def main():
    changed = 0
    for path in sorted(glob.glob('data/*.json')):
        result = resync_file(path)
        if result:
            (op, od, oo), (np, nd, no) = result
            print(f"resynced {os.path.basename(path)}: "
                  f"price {op}->{np}  date {od}->{nd}  obs {oo}->{no}")
            changed += 1
    print(f"done: {changed} file(s) resynced ({len(glob.glob('data/*.json'))} scanned)")
    return changed


if __name__ == '__main__':
    main()
