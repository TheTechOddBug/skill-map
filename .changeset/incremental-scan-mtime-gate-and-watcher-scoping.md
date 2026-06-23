---
"@skill-map/cli": patch
---

Incremental scans now skip unchanged files. The full-walk path (`sm scan --changed`, boot scan, fallback) reads and YAML-parses only files whose on-disk mtime differs from the prior snapshot, reusing the cached node otherwise. The watcher path (`sm serve` / `sm watch`) threads chokidar's exact changed-path set through the scan, enumerating the corpus from the prior snapshot and reading only the touched files instead of re-walking the tree. Results stay byte-identical to a full scan.

## User-facing

**Faster live updates.** Saving a file while `sm serve` or `sm watch` is running now refreshes the map almost instantly, because only the file you changed is re-read instead of the whole project being re-scanned on every save.
