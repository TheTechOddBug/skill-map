---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

The active lens is now a cache input. Each scan records it in `scan_meta.active_provider` (new column, mirrored on `ScanResult.activeProvider`) and the next one rebuilds every node when it differs, since the lens decides per-node classification and gates provider-specific extractors. This catches a lens changed out of band, where the `scan_*` drop performed by `sm config set activeProvider` never runs. The walker's `tokenizerChanged` flag generalises into `cacheInvalidatedBy`.

## User-facing

If the active tool changes without going through Settings (a hand-edited or pulled config), the next scan now re-reads the whole project instead of keeping files labelled under the old tool.
