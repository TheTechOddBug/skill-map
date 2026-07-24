---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Codex live-map + queue parity, additive (Claude unchanged). A subagent whose own end signal Codex drops (nested spawn) now releases at turn end: the main-context `Stop` maps to a node-less session-scoped `node.activity` frame (`sessionScope` + `session`) that clears every owner of the session, instead of glowing until the 5-minute decay. And MCP `claim_job` gains an opt-in `wait` (seconds) for a server-side blocking long-poll, so a runtime that cannot park a shell command drains without polling.
