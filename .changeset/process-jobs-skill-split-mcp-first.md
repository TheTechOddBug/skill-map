---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The `sm-process-jobs` agent process skill becomes a 3-file progressive-disclosure set (`SKILL.md` always loaded, `mcp.md`/`cli.md` read on demand), installed and status-checked atomically by the agent-skill engine. It now defaults to resident/watch (`once` drains a single pass), probes for MCP tools first (silent in hybrid mode, one-time ordered 3-step setup tip when absent), and renames the queue-processing sense `drain` to `process`. README and spec MCP docs updated for the queue-aware server.

## User-facing

**The process skill now runs resident and tries MCP first.** `sm agent install` writes a 3-file skill that stays resident to process the job queue, uses the MCP tools when present, and when the MCP server is off tips you how to turn it on.
