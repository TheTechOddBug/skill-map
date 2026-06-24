---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Removed the `comingSoon` provider flag: not-ready providers use `stability: 'experimental'`, shipping disabled by default (not classified, auto-detected, or selectable until enabled). `openai`, `antigravity`, `agent-skills` are experimental; `agent-skills` is gated to its own lens (only `core/markdown` stays universal). Antigravity reuses the agent-skills classifier, dropping the kernel's cross-provider reservedNames lens-scope. `sm tutorial --experimental` offers them as destinations.

## User-facing

The lens dropdown no longer shows "(coming soon)" rows. Not-ready providers (OpenAI Codex, Antigravity, Open Skills) are hidden until you enable them with `sm plugins enable <id>`; `sm tutorial --experimental` offers them as tutorial destinations.
