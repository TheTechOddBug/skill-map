---
"@skill-map/cli": patch
---

The workspace search now narrows the map by default, not just the files rail: a query filters both surfaces so it focuses the whole workspace at once. The prior default (map keeps its full layout while only the rail narrows) moves behind the rail's search-to-map toggle and the persisted `sm.workspace.search-affects-map` preference (an absent key now reads as on). Tutorial references updated to match.

## User-facing

Typing in the workspace search now filters the map too, not just the files list, so a query focuses the whole workspace. Want the map to keep its full layout? Turn off the search-to-map toggle next to the search box.
