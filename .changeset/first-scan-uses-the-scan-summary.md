---
"@skill-map/cli": patch
---

The first scan (`sm init`, and the bare `sm` bootstrap that delegates to it) now prints the same summary block `sm scan` does, counts row plus database path, instead of its own one-line `First scan: 9 nodes, 9 links, 2 issues.` variant. That line also led with a red `✕` whenever any issue was at error severity, which read as "the scan failed" on a scan that succeeded. The renderer moved to `cli/util/scan-summary.ts` and both verbs call it.

## User-facing

The first scan after setup now reports its results in the same format as every later `sm scan`: nodes, links and issues split by severity, then the database path. No more red mark on a scan that worked.
