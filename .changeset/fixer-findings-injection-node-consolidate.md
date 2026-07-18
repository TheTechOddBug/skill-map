---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Fixer findings injection (Decision #141) plus the first fixer `core/ai-redundancy-action`. Submitting a probabilistic Action that declares `precondition.analyzerIds` now injects the node's non-stale matching findings into a `## Findings to resolve` section of the rendered job (folded into `promptTemplateHash`), and refuses when the node has none. `core/ai-redundancy-action` (stable) resolves `core/ai-redundancy-analyzer` findings via a template-mandated file edit.

## User-facing

New fix-it jobs: after an AI review flags issues, queue a matching fixer (like `core/ai-redundancy-action` for repetition) and the draining agent edits the file to resolve exactly what was flagged.
