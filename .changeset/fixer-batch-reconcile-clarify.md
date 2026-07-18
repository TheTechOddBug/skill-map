---
"@skill-map/cli": minor
---

Two more built-in fixers (probabilistic Actions declaring `precondition.analyzerIds`), experimental and disabled by default. `core/node-reconcile` resolves `core/node-contradiction` findings by settling conflicting or jointly-risky directive pairs. `core/node-clarify` resolves `core/node-incoherence` findings (dangling references, drifting terms, missing context). Both refuse when the node has no matching non-stale finding; the draining agent edits the file.

## User-facing

Two more optional fix-it jobs: reconcile conflicting or jointly-risky directives, and clarify incoherent docs (dangling references, drifting terms, missing context). Enable a fixer under Settings or with `sm plugins enable`, then queue it with `sm job submit`.
