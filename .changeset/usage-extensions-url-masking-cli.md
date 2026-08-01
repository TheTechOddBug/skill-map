---
"@skill-map/cli": minor
---

Usage events now name the extensions involved beyond the scan: `cli.enrich` carries the ids its deterministic pass refreshed, and `cli.jobs` (submit / claim) plus `cli.record` carry the job's extension id, deduped with third-party ids collapsed to `external_plugin`. Both telemetry scrubbers (CLI/BFF and UI) also mask the values of the `path` / `search` URL query parameters as `<masked>`, so a `$current_url` like `/?kinds=skill&path=...` no longer leaks the node path.

## User-facing

Usage analytics (if you turned them on) now report which extensions ran on enrich and queue operations, still names only. URLs in telemetry no longer include your node paths or search text; those query values are replaced with a mask before anything leaves the machine.
