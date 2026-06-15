---
"@skill-map/cli": minor
---

Move the inspector Set stability button to the `core/node-set-stability` action's scan-time `project()`. The button now tracks the action's enabled state (a disabled action projects no button) instead of the `core/node-stability` analyzer emitting it unconditionally. The analyzer also stops raising an `info` for `experimental` nodes (only `deprecated` still raises a finding, experimental stays a chip) and ships a clearer plugins-list description.

## User-facing

The Set stability button no longer shows when its action is turned off (it used to leave a dead button), and experimental files no longer add an info row to Findings; the experimental badge still shows on the card.
