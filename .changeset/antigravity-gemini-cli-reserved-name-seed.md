---
'@skill-map/cli': patch
---

Internal: expand the `antigravity` Provider's `reservedNames.command` seed catalog from 6 entries to the full 38-verb Gemini CLI slash-command surface plus its 4 documented aliases (42 total). Google's transition blog (2026-05-19) states that the Antigravity CLI fully replaces Gemini CLI, preserves the four feature pillars (Agent Skills, Hooks, Subagents, Extensions), and shares the same agent harness as the Antigravity 2.0 desktop app, so the operator's built-in slash-command vocabulary almost certainly carries over 1:1. The catalog stays inactive (the analyzer keys on `node.provider` and the `antigravity` Provider still classifies nothing), no behavioural change today; the seed is in place for the day Antigravity grows its own kind. Provisional label inline; reconcile when antigravity.google/docs publishes the authoritative reference.
