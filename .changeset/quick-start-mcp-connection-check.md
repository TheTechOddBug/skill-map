---
"@skill-map/cli": patch
---

Quick Start's "MCP installed on your agent" row now verifies the LIVE connection instead of only a project-committed registration. A new `GET /api/mcp/status` reports whether a client is actually connected to `/mcp` (`McpSessionManager` session count), which is scope-agnostic and reads no `$HOME`, so it works whether the agent registered at local, project, or user scope. The row gains a Check button, and the instructions walk copy, run, approve the connection in your agent, then Check.

## User-facing

Quick Start's "MCP installed on your agent" step now has a Check button that confirms your agent is actually connected to the MCP server (in any scope), instead of only detecting a project-committed registration.
