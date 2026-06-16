---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Ship the `core/node-bump` action and the `core/annotation-stale` analyzer as `experimental`, so the sidecar bump/drift surface is disabled by default (Decision #128). Gated as a unit: with the action disabled no Bump button projects, and with the drift analyzer disabled no stale finding fires. The `sidecar-end-to-end` conformance case drops its `annotation-stale` assertion accordingly (a default scan now surfaces only `annotation-orphan`; the node still carries the derived `sidecar.status`).

## User-facing

The Bump button and the sidecar drift ("stale") finding are off by default now. Staleness still shows on the node's status; re-enable with `sm plugins enable core/node-bump core/annotation-stale` or the Settings toggles.
