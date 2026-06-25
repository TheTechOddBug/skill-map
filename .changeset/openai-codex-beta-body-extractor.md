---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The OpenAI Codex provider is now beta (enabled by default): a `.codex/` directory auto-detects the openai lens and `.codex/agents/*.toml` files classify as agents. A Codex agent's prompt (the TOML `developer_instructions` field) flows through the link extractors via the new declarative `read.bodyField` knob, so `@mention` and `[link]` references inside it surface in the graph. `AGENTS.md` is no longer a detection marker (it is the vendor-neutral agents.md standard, common in non-Codex repos).

## User-facing

OpenAI Codex is now a built-in provider. Open a project with a `.codex/` folder and skill-map maps your Codex sub-agents plus the links inside their developer instructions, the same way it does for Claude. Pick it anytime from the provider lens.
