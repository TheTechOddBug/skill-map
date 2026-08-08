---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`core/backtick-path` now stamps its signals with the code-region `context` (`inline-code` / `code-block`) like the trigger siblings do, so `core/link-self-loop`'s usage-example exemption finally applies to backticked paths: a file naming itself in a code span (a `SKILL.md` or `AGENTS.md` self-mention) no longer warns as a self-loop. The trigger resolution gate stays kind-gated, so unresolved `points` paths keep flagging `reference-broken`; the spec's Emission contract documents the stamp.

## User-facing

**No more false self-loop warnings on self-mentions.** A document that names its own file inside backticks (a usage example, like a skill citing its own SKILL.md) no longer gets flagged as a self-reference loop.
