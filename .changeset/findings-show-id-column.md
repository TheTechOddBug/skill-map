---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

`sm findings` human output now prefixes each finding row with its numeric id (right-aligned per node section so the severity glyphs stay in one column), the handle you pass to `sm findings resolve <id>`. Previously the id showed only in `--json`, forcing a jq/grep detour to act on a finding.

## User-facing

`sm findings` now shows each finding's id at the start of its row, so you can pass it straight to `sm findings resolve <id>` without digging through `--json`.
