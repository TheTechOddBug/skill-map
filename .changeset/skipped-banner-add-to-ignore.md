---
'@skill-map/cli': patch
---

The skipped-files banner's CTA now performs the fix instead of navigating to it: "Add to ignore" appends every skipped file to `.skillmapignore` in one click (root-anchored exact paths, merged into the existing pattern list through `PATCH /api/project-ignore`), and the watcher restart that write already triggers rescans and clears the banner on its own. The former "Open Project settings" CTA is gone; raising `scan.maxFileSizeBytes` stays available in Settings > Project.

## User-facing

When files are skipped for exceeding the size limit, the banner button now adds them to the ignore file directly, and the map rescans by itself, instead of just opening Settings.
