---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

While a node glows in the live map, a small badge on the card now names the literal tool that lit it (Claude `Skill` / `Read` / `Agent`, Codex `spawn_agent`, Antigravity `view_file`, opencode `skill` / `read`, plus MCP tool names). The existing `detail` field carries it end to end; `spec/provider-activity.md` §detail blesses unit-frame detail and moves the invocation-edge gate to the `mcp://` node path.

## User-facing

**See which tool lit a card.** While a node glows during a live session, a small badge on the card names the exact call that triggered it: a skill invocation, a file read, a subagent spawn, or the MCP tool. It fades with the glow.
