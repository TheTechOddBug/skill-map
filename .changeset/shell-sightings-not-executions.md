---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Shell path sightings (capture level rung 5) no longer count as node executions: the stats accumulator routes them to the typed recent log only, and the spec names the exclusion explicitly. The shell opt-in writers (`sm activity install --shell`/`--no-shell` and the HTTP install body's `shellCapture` field) now refuse a provider whose descriptor carries no shell opt-in event, so the capture-level `shell` selector can never unlock with no capture wired behind it.

## User-facing

Paths mentioned in shell commands no longer count as node executions (they still appear in the recent activity log), and the shell capture opt-in is only accepted for providers that support it (Claude today).
