---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Surface provider-marker drift in the web UI instead of the server log. `sm serve` / `POST /api/scan` no longer log the `Provider markers changed` warning; `GET /api/active-provider` now returns a `markerDrift` field and the SPA shows a dismissable notice to switch lens or dismiss. Dismissing (`POST /api/active-provider/accept-markers`) reconciles the `activeProviderMarkers` snapshot so the drift clears in both UI and CLI. `sm scan` / `sm watch` keep the warning.

## User-facing

**Marker-change notice moved into the map.** If a new provider folder (like `.claude/`) appears, the map shows a dismissable banner to switch lens or keep your current one, instead of repeating a warning in the server console. Dismissing it remembers your choice.
