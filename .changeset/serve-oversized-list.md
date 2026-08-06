---
'@skill-map/cli': patch
---

The `sm serve` console now prints skipped-for-size files as a list, one `path (size)` row per line, the same shape `sm scan` and `sm watch` already print. It used to join them with commas into a single line, which is exactly where the UI banner's "see the full list in the console" sent the operator when more than six files were skipped.

## User-facing

When files are skipped for exceeding the size limit, the server console now lists them one per line instead of cramming them into a single run-on line.
