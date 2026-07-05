---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Live activity v1.1: ephemeral per-node execution stats in the BFF (keepAlive-aware counting, summary endpoint, stats riding node.activity frames), stateless agent.spawn WS frames from the new spawn relation on activity signals, sessionized main owners (main:<session_id>) in claude and codex, and opt-in conversation capture (activity.captureConversations, consent-gated, off by default) retaining both spawn halves, with async responses attached from the child's terminal stop report.

## User-facing

Nodes now show how many times your AI assistant ran them, live dashed arrows connect agents to the agents they spawn (with a session marker when spawned from your chat), a topbar switch toggles Real Time, and you can opt in to view agent-to-agent conversations from the map.
