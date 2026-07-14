---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Fixer findings injection (Decision #141) plus the first fixer `core/node-consolidate`. Submitting a probabilistic Action that declares `precondition.analyzerIds` now injects the node's current non-stale matching findings into a `## Findings to resolve` section of the rendered job (folded into `promptTemplateHash`, so non-fixer jobs never re-key), and refuses when the node has none. `core/node-consolidate` (experimental) resolves `core/node-redundancy` findings via a template-mandated file edit.

## User-facing

New optional fix-it jobs: after an AI review flags issues, enable a matching fixer (like `core/node-consolidate` for repetition) and queue it, and the draining agent edits the file to resolve exactly what was flagged.
