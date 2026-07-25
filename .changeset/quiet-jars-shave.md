---
'@skill-map/cli': patch
---

Edge-kind toggles in the graph view are now an independent show / hide per link kind. `FilterStoreService.toggleLinkKind` takes the kinds the palette actually paints as its universe (it started from the spec-fixed catalog, so kinds absent from the scan stayed in the whitelist) and gained the sticky all-off state the node-kind toggle already had, so turning the last kind off keeps the canvas edgeless instead of collapsing the whitelist back to "no filter".

## User-facing

**Link type toggles now just show and hide.** Each link type button in the map toolbar turns those arrows on or off on its own. Turning the last one off leaves the map with no links, instead of switching every type back on.
