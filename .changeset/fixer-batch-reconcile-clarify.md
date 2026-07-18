---
"@skill-map/cli": minor
---

Two more built-in fixers (probabilistic Actions declaring `precondition.analyzerIds`), stable, enabled by default. `core/ai-contradiction-action` resolves `core/ai-contradiction-analyzer` findings by settling conflicting or jointly-risky directive pairs. `core/ai-incoherence-action` resolves `core/ai-incoherence-analyzer` findings (dangling references, drifting terms, missing context). Both refuse when the node has no matching non-stale finding; the draining agent edits the file.

## User-facing

Two more fix-it jobs, on by default: reconcile conflicting or jointly-risky directives, and clarify incoherent docs (dangling references, drifting terms, missing context). Queue one with `sm job submit`.
