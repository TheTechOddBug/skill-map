---
'@skill-map/cli': patch
---

The UI's submit gate now closes on either half of the processing-agent pair: the lens's skill not installed, OR no agent attached to `/mcp`. `ProcessingAgentReadinessService` owns both probes and exposes `submitGateClosed` / `submitGateReason`, so every submitting affordance (the Auto-fixer switch included) shares one signal and picks its own tooltip; while `/mcp` is live with zero clients it re-probes on a light poll, reopening the gate as soon as the agent connects.

## User-facing

**AI buttons wait for your agent.** Summarize, auto-tag and the AI Actions buttons now stay disabled while no agent is connected to the MCP, instead of queueing work nobody picks up. They re-enable on their own once you start your agent.
