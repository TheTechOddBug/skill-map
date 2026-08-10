---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

`sm activity status` gains `--verify`, a wiring self-test that pushes one synthetic probe event through the installed activity bridge and asks the running server whether it arrived, so a crashing bridge, a dead server or a stale `serve.json` stops reading as a green `installed`. Backed by a new `GET /api/activity/probe` readback plus a `__skillMapProbe` short-circuit in `POST /api/activity` that keeps probes from lighting nodes or counting as executions. Failing verdicts exit 1.

## User-facing

`sm activity status --verify` now proves your live-activity wiring actually works: it sends a test event through the installed bridge and reports whether the server received it, instead of showing a green check while the map stays dark.
