---
"@skill-map/cli": patch
---

The `sm-process-jobs` skill gains a hard rule: talk to skill-map only through the typed MCP tools or the `sm` CLI verbs, never by hand-crafting HTTP against `/mcp` (`curl` + JSON-RPC bodies, manual session ids). Live-observed on OpenCode: a session without the native tools improvised its own raw MCP session over curl instead of falling back to the CLI path the skill already provides.

## User-facing

An agent whose session lacks the skill-map MCP tools now falls back to the CLI verbs as intended, instead of spamming your terminal with hand-built curl calls against the MCP endpoint.
