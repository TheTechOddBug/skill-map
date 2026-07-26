---
"@skill-map/cli": patch
---

The OpenCode activity plugin also forwards `chat.params`, reduced at the wiring level to `{ agent, sessionID }` (the user message it carries never leaves the process). It fires before each model call, so the owner index learns which agent a session runs BEFORE the turn's first `task` spawn; `chat.message` only fires with the completed assistant message, after the delegation already ran, so a turn's first delegation arrow still anchored on a session capsule.

## User-facing

On OpenCode, the delegation arrow now starts at the agent that delegated from its very first delegation, instead of a "Session" bubble for the first one. Requires reinstalling the hook and restarting OpenCode.
