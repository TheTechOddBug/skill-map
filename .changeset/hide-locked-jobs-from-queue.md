---
"@skill-map/cli": patch
---

`GET /api/jobs` (the UI queue list) now hides jobs from host-locked system extensions like the `ai-ping-action` liveness probe, so the Quick Start "agent attending jobs" pings no longer clutter the Queue tab, matching how `locked` already strips them from the plugin list and MCP `list_extensions`. `sm jobs list` (a power-user surface) still shows them.

## User-facing

The Queue tab no longer shows the internal liveness-probe (ping) jobs that the Quick Start "agent attending jobs" check submits.
