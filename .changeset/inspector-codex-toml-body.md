---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The inspector now renders OpenAI Codex agents (`.codex/agents/*.toml`) like a Markdown node: the TOML `developer_instructions` field becomes the Body section (rendered as Markdown) and the other TOML keys the Definition/metadata card, instead of showing the raw TOML file. A new optional `bodyField` on each `providerRegistry` entry (projected from the provider's `read.bodyField`) drives the split, so it stays provider-driven with no hardcoded provider id.

## User-facing

Codex agents (`.codex/agents/*.toml`) now open in the inspector with a proper metadata section and a readable, Markdown-rendered body, instead of a wall of raw TOML.
