---
"@skill-map/spec": minor
---

The `inspector.action.button` payload gains an optional `surface` enum (`version` | `stability` | `tags`) plus the `view-slots.md` §Re-homed surfaces contract: a payload declaring a surface IS the named UI surface instead of a generic Actions button, the UI selects it by this declaration and dispatches the payload's `actionId` (never matching extension ids), and when several contributions claim one surface the first by priority order wins.
