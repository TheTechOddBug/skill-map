---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

The `sm findings` bucket flags become filters: `--fixed` now shows ONLY the fixed rows and `--stale` ONLY the stale ones (their union when combined), instead of appending the hidden bucket to the default listing. The excluded-count reporting stays a default-view-only honesty device; an explicit bucket filter is the operator's own narrowing, like `--type`.

## User-facing

`sm findings --fixed` now lists just the fixed findings (and `--stale` just the stale ones) instead of mixing them into the full list, so reviewing what a fixer did no longer means scrolling past everything else.
