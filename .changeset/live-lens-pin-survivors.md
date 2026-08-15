---
'@skill-map/cli': patch
---

The Live lens incremental layout now pins the nodes it has already placed (d3-force `fx`/`fy`) instead of re-simulating them, and keeps the whole-cloud centring forces for the cold-start run only. A node joining the live set used to nudge every other node, which read as flicker; survivors now hold their exact position and only the newcomers settle.

## User-facing

The Live lens map no longer jitters: when a new file starts executing, the nodes already on screen stay exactly where they were instead of drifting around it.
