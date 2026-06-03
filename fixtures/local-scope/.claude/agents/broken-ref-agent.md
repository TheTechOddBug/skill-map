---
name: broken-ref-agent
description: Demonstrates the broken-reference scenario. The sidecar's `requires` annotation points at a node that does not exist on disk (`.claude/skills/does-not-exist/SKILL.md`), exercising the broken-ref analyzer and the muted chip rendering in the inspector.
model: sonnet
tools:
  - Read
---

# Broken-ref Claude agent

Reference fixture for the broken-reference UI state. The frontmatter is valid, but the sidecar deliberately requires a path that is not in the local store. The broken-ref analyzer should flag this; the inspector should render the dangling chip with the muted / strikethrough variant.
