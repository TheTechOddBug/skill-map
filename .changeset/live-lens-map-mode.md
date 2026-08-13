---
'@skill-map/cli': patch
---

New Live lens mode in the graph view: a toolbar toggle narrows the canvas to the nodes the AI runtime is executing plus the recently-executed ones inside a configurable linger window (5 minutes by default, no-limit option, one-click reset), with automatic layout, camera framing, dragging disabled and a red on-air frame. Links that actually fired (invocations, spawns, executing chains) persist instead of expiring with their live TTLs; exiting restores the curated map exactly.

## User-facing

New in the map: the Live lens. Toggle it from the bottom toolbar to watch only what your AI is executing right now, plus what ran in the last 5 minutes (or keep everything until you reset). The calls between files stay drawn, and exiting brings your map back untouched.
