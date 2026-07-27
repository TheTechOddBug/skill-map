---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Interrupted or failed sub-agent spawns no longer linger on the live map: the claude adapter maps the main-context `Stop` to a new node-less `turnEnd` frame that sweeps the turn's dead sync spawn relations (re-run `sm activity install claude` to wire it), and a completion-less relation is no longer kept alive by its own session's heartbeats. Also fixes the client event guard rejecting the node-less `sessionScope` form (Codex's turn-end release went unprocessed).

## User-facing

If you cancel or interrupt your agent while it delegates work, the dashed live arrow and its capsule now disappear when the turn ends instead of sticking around for the rest of your session. Re-run `sm activity install claude` once so the new turn-end hook gets wired.
