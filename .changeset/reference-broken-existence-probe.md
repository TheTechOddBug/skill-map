---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The reference-broken verdict gains an on-disk existence probe: a path-style link whose target exists under any scan root no longer flags broken even when the file is not an indexed node (JSON schemas, images, ignored or oversized markdown). The lazy memoized probe runs in `collectBrokenLinks`, threaded by the scan runner, the watcher, and `scan compare-with`. With those false positives gone, `BROKEN_PENALTY` hardens from 0.5 to 0.75: a broken edge folds to 0.25, above the reserved 0.1.

## User-facing

Links to files that really exist on disk (JSON, images, docs) no longer show as broken references. Only links pointing at genuinely missing files flag now, and they stand out more: their arrows render much fainter on the map.
