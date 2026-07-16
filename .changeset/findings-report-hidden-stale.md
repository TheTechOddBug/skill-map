---
'@skill-map/spec': minor
'@skill-map/cli': patch
---

`sm findings` no longer reports a clean node while hiding stale judgments. The default filter excludes stale rows, but the empty result printed a bare `No findings` with a success glyph, which reads as "nothing was found" when the finders had in fact judged the node and an edit merely aged their verdicts. Human mode now says `No fresh findings` plus the hidden count and its remedy, listings footer the hidden count, and `--json` carries `staleExcluded`.

## User-facing

`sm findings` used to say "No findings" after you edited a file, hiding results that were merely outdated. It now tells you how many are hidden and how to see them (`--stale`) or refresh them.
