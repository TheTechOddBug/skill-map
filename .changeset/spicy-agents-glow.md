---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The graph now renders an ephemeral agent capsule for a spawned runtime sub-agent that matches no scanned node (a vendor built-in with no file on disk), aggregated per parent and name with a live-run count and released with its last live relation; a session spawning only built-ins previously drew nothing. Session anchors float beside the project-instructions card (`AGENTS.md` / `CLAUDE.md`), and dragging a live anchor no longer snaps back mid-drag. Spec: `provider-activity.md` §agent.spawn.

## User-facing

When your agent spawns built-in helpers that are not files in your project (an explorer, a planner), the map now shows them as live dashed capsules with a run counter, hanging off whoever spawned them. Your session bubble also docks next to your AGENTS.md / CLAUDE.md card.
