---
"@skill-map/cli": minor
---

Three built-in finder Analyzers complete the wave-1 roster: `core/node-contradiction` (directives that cannot both be followed), `core/node-incoherence` (dangling references, drifting terminology, steps out of order), and `core/node-contraindication` (individually valid directives that are jointly risky). Same mold as `core/node-redundancy`: probabilistic, experimental and disabled by default, each report schema narrowed to its own finding type; finders judge independently.

## User-facing

Three new optional AI reviews for your files: contradiction, incoherence, and risky-combination detection. Enable each under Settings or with `sm plugins enable`, queue with `sm job submit`, read results with `sm findings`.
