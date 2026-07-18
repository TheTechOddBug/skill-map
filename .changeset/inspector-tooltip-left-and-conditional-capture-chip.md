---
"@skill-map/cli": patch
---

Inspector action-button and AI-actions launcher tooltips now open to the left and append to `body`, so they no longer collide with the right screen edge or clip inside the inspector's scroll container. The activity "capture on" chip now renders only when conversation capture is enabled and the node has at least one retained spawn, instead of showing on every node whenever the global capture gate is on.

## User-facing

**Inspector tooltips and the capture badge.** Button tooltips in the inspector now open toward the screen instead of getting clipped at the right edge, and the "capture on" badge shows only on nodes that kept conversations, not on every node while capture is on.
