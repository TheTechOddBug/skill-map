---
'@skill-map/cli': minor
---

Inspector and processing-skill polish. The findings card is renamed "AI actions", launcher buttons drop the `node-` prefix, and the empty-state / honesty line were removed. A selected node's selection ring yields while it executes so the live treatment stays readable. Two `sm-process-jobs` fixes: re-scan with `sm scan --changed` (the old `sm scan -n <path>` was wrong, `-n` is `--dry-run`, roots are directories), and report tersely (one line per job).

## User-facing

The inspector's findings panel is now "AI actions" with cleaner button names, and the processing skill reports more concisely and re-scans correctly after a fix.
