---
'@skill-map/cli': patch
---

The Live lens now scopes the whole workspace, not just the map: the files rail lists only the files seen executing (the same membership the canvas paints, so the replay narrows it as the tape advances) and shows its own "nothing has executed yet" state instead of the filters one, while the Queue tab is disabled for the duration and an open queue panel falls back to files.

## User-facing

The live lens now also narrows your file list to what the AI actually touched, so the panel and the map tell the same story. The Queue tab stays out of the way while the lens is on.
