---
"@skill-map/cli": patch
---

The active-provider auto-detect line (`Auto-detected activeProvider = ... persisted to settings.json`) no longer interleaves with the scan summary. The bootstrap printed it to stderr while `sm scan` writes its summary to stdout, so on a tty the two streams glued together with no newline between them. The bootstrap now stays silent and the CLI announces the auto-detect on the summary's own stream (stdout for `sm scan`, stderr for `sm init`), in order, on its own line.

## User-facing

`sm scan` no longer glues the `Auto-detected activeProvider` notice onto the results line. The auto-detect message now prints on its own line, right above the scan summary.
