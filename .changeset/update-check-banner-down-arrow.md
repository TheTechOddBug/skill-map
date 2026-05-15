---
'@skill-map/cli': patch
---

Swap the leading glyph in the `Update available` banner header from
`⬆` (HEAVY UPWARDS BLACK ARROW, U+2B06) to `⬇` (HEAVY DOWNWARDS BLACK
ARROW, U+2B07). The down arrow reads as "a newer version is coming
DOWN to your machine" (incoming download), which is the same semantics
the banner is already conveying with the `<current> → <latest>` line
just below; the previous up arrow's "upgrade outward" reading was
inconsistent with that downward flow. Single-character edit in
`src/cli/util/update-check-banner.ts:189`; both characters are East
Asian fullwidth and occupy the same number of terminal cells, so
`BANNER_WIDTH` math and the border `─` fill remain correct without
adjustment.

## User-facing

The `Update available` banner now leads with a **down arrow** (`⬇`)
instead of the previous up arrow, reading as "an update is coming in"
rather than "upgrade outward".
