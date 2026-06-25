---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The OpenAI Codex provider and plugin id was renamed from `openai` to `codex`, aligning the id with its `.codex/` marker and the product-name scheme of the other built-ins. The lens value (`activeProvider`), `node.provider`, the conformance scope (`provider:codex`), and qualified extension ids (`codex/codex`) change accordingly. Breaking but greenfield (no released consumers); the displayed lens label "OpenAI's Codex" is unchanged.

## User-facing

The OpenAI Codex provider id is now `codex` (was `openai`). If you set it by hand, use `codex` in `sm config set activeProvider` or `sm plugins enable`. The name shown in the app is unchanged.
