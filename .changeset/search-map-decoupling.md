---
"@skill-map/cli": patch
---

Decouples the workspace text search from the map: `FilterStoreService.apply()` gains an `includeSearch` option and the graph view only applies the query when the new persisted `searchAffectsMap` preference (toggle next to the rail search input, default off) is enabled. The files rail keeps filtering on every query.

## User-facing

Searching no longer rips nodes out of the map: by default the query narrows only the files list while the map keeps its layout. A new toggle next to the search box brings back the old filter-everything behavior, and your choice is remembered.
