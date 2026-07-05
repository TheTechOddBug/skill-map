---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Live activity: per-pair spawn counters in the stats accumulator (metadata, independent of the capture gate), exposed as a pairs map on GET /api/activity/summary and as an overwrite-only pairCount field on agent.spawn frames, feeding the UI's edge conversation-count labels and the historical edge click-through into the threaded conversation dialog.

## User-facing

Graph edges now show how many agent conversations passed through them, and clicking an edge that carries a count reopens the same chat dialog the inspector shows, even after the live run ended.
