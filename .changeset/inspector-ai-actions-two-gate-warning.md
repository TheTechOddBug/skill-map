---
"@skill-map/cli": patch
---

The node inspector's AI Actions warning now layers two mutually-exclusive gates instead of keying off live MCP connection alone. The primary gate fires when the active lens supports a processing skill that is not installed; the secondary gate fires only once the skill is installed but no client is connected to the MCP yet, and clears as soon as the agent opens a session. At most one message shows, and neither shows while its signal is unknown.

## User-facing

The inspector's AI Actions warning is now clearer: it first tells you to install the processing skill, and only then flags that no agent is connected to the MCP yet.
