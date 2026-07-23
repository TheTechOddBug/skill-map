---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The opt-in `/mcp` server (`mcp.server.enabled` / `sm serve --mcp`) is no longer read-only: the same toggle also exposes queue tools (submit/claim/record/cancel/fail jobs, plus list/get and extension discovery) and findings-lifecycle tools (list, resolve, dismiss, reopen, undismiss, delete), thin wrappers over the shared claim/record engines the CLI verbs already use, so an MCP host can drive the job queue and manage findings over one endpoint. Loopback-only and unauthenticated as before.

## User-facing

**Your MCP assistant can now run the queue, not just read the map.** One toggle (Settings > Project, or `sm serve --mcp`) lets a connected AI assistant drive the job queue and manage findings over `/mcp`, from submitting and recording jobs to resolving or dismissing findings.
