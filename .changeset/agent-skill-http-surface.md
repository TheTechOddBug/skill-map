---
"@skill-map/spec": minor
---

The HTTP API gains the agent-drain-skill install surface, mirroring the activity-hooks endpoints: `GET /api/agent/install?provider=` (status probe with `supported` / `installed` / `stale`, the fields behind the UI button's Install / Update / Up to date states), and the 412-consent-gated `POST /api/agent/install` (three-state `outcome`) and `POST /api/agent/uninstall` (`removed`). The materialised skill folder is a bundled ignore default: skill-map infrastructure never surfaces as a node.
