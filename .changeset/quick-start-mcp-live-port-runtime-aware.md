---
"@skill-map/cli": patch
---

The process-jobs skill's MCP setup step is now runtime-agnostic (per-runtime registration for claude / codex / opencode / antigravity, plus a Codex note to claim over MCP with `wait`). Quick Start's MCP register command uses the LIVE server URL, so `sm serve --port N` shows `N` instead of a hardcoded 4242, and the "agent waiting for jobs" hint shows the active lens's invocation (`/sm-process-jobs` vs `$sm-process-jobs`). Installing the real-time hook now recommends restarting the agent and `sm`.

## User-facing

The Quick Start MCP command now uses the port your server is actually on, and the agent-processing hint shows the right invocation for your runtime.
