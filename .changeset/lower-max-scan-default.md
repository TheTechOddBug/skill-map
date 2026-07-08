---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Lowers the default scan corpus ceiling `scan.maxScan` from 50000 to 5000 files. Projects above the limit now truncate by default (extra files are left out of the map, not scanned or reference-validated), and `sm scan` prints a reworded advisory pointing at `.skillmapignore` to filter noisy folders (e.g. node_modules/, dist/, build/) or `--max-scan <N>` to raise the limit. Fully overridable per project via `scan.maxScan` in settings.json or per invocation via `--max-scan`.

## User-facing

skill-map now scans up to 5000 files by default (was 50000). Larger projects get a terminal notice suggesting you filter noisy folders with .skillmapignore, or raise the limit with --max-scan. You can set any value under scan.maxScan in .skill-map/settings.json.
