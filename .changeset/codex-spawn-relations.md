---
"@skill-map/spec": patch
"@skill-map/cli": minor
---

Codex live-activity parity: the codex adapter wires the spawn_agent Pre/PostToolUse pair (matcher-scoped, the only tool events) and emits spawn relations with the prompt on start and the child agent_id parsed from the JSON-string response on handoff, plus the stop's last_assistant_message as the conversation response via the generic report path. No custody (codex parents never pause), no execution totals (the payloads carry none); spec table updated from the 2026-07-05 probe.

## User-facing

Codex sessions now get the same live map extras as Claude: spawn arrows between agents, per-edge conversation counters, and opt-in agent-to-agent conversation viewing. Execution totals stay empty on Codex, its runtime does not report them.
