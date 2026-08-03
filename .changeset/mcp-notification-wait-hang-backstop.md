---
"@skill-map/cli": patch
---

The MCP integration spec's wall-clock budget for the `notifications/resources/updated` round-trip (`src/server/__tests__/server-mcp-integration.spec.ts`) goes from 4s to 15s, in line with the 8s waits the sibling WebSocket spec already uses. The delivery path is synchronous and the test measures 40-180ms locally, so the budget is a hang backstop rather than a latency assertion, and a contended CI runner starved it past 4s anyway. Test-only change, no runtime behaviour affected.
