---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Provider activity adapters declare `spawnCustody`, and a `blocking` runtime's owner-scoped end now carries `terminal: true`, releasing the spawns that owner parents instead of counting as a pause. The pause-is-not-end rule is Claude-shaped: OpenCode blocks the parent inside the `task` call, so an idle parent is finished. Without this a spawn whose completion never arrives, the shape a refused call leaves, stayed drawn for the full five-minute decay window.

## User-facing

A delegation arrow that ends badly (the runtime refused the call, the agent crashed) now clears as soon as the session finishes, instead of hanging on the map for five minutes.
