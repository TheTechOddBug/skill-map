---
name: architecture
description: Top-level markdown that no vendor Provider claims. Picked up by core/markdown's universal fallback classify.
---

This file lives at the project root with no platform-specific path
prefix. The claude / openai / agent-skills Providers all return null
on it; the built-in `core/markdown` Provider claims it as kind
`markdown`. Without the universal fallback it would be silently
dropped from the scan.
