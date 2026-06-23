---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Splits the scan cap into two knobs: `scan.maxScan` (corpus ceiling, default 50000) bounds what the walk parses and reference-validates, while `scan.maxNodes` (default 256) now caps only the graph render. References resolve across the whole corpus, so large repos no longer flag links to unrendered files as broken. Adds the `--max-scan` flag and the `/api/folders`, `/api/branch`, and `/api/scan?meta=1` endpoints that back the lazy folders tree and branch-scoped map.

## User-facing

Large repos now scan and validate references across the whole tree; check folders (with per-folder issue counts) to choose what the map shows. Map palettes count what is shown; a Reset filters button clears it all; the refresh button spins while any scan runs.
