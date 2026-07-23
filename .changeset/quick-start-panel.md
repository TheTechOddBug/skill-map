---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

A new Quick Start panel (rocket icon in the topbar) reports what each capability needs across Live update, Real Time and AI Actions, one live status and action per row. `GET /api/health` gains an `mcp` boolean (the live `/mcp` state, separate from the `mcpServerEnabled` preference). A hidden `locked` system extension `core/ai-ping-action` (absent from every catalog; `list_extensions` skips locked ids) backs the agent-liveness check: a claimed ping proves an agent is draining the queue.

## User-facing

**New: a Quick Start panel (rocket icon, top right).** One place to see what each feature needs, live updates, real-time activity, capture, and the AI/MCP pieces, with the status of each and a button to turn it on. It can even check whether an agent is answering the job queue.
