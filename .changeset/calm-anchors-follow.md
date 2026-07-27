---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Session anchors no longer dock beside the AGENTS.md / CLAUDE.md card: the instructions-node affinity was retired after live use (the session cluster parked away from the agents actually running). A session now floats above the centroid of the agents it runs; capsule-only sessions hover above the graph top. Clamp, collision dodge and drag overrides are unchanged. Placement note updated in `spec/provider-activity.md`.

## User-facing

Live session capsules now float above the agents they are running instead of docking next to AGENTS.md, so the activity reads right where the work happens. Drag still wins if you prefer them elsewhere.
