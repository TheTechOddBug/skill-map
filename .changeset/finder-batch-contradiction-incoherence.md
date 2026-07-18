---
"@skill-map/cli": minor
---

Two built-in finder Analyzers complete the wave-1 roster: `core/ai-contradiction-analyzer` (directive pairs that cannot both be followed, or whose combination is jointly risky) and `core/ai-incoherence-analyzer` (dangling references, drifting terminology, steps out of order). Same mold as `core/ai-redundancy-analyzer`: probabilistic, experimental and disabled by default, each report schema narrowed to its own finding type; finders judge independently.

## User-facing

Two new optional AI reviews for your files: contradiction (including risky directive combinations) and incoherence detection. Enable each under Settings or with `sm plugins enable`, queue with `sm job submit`, read results with `sm findings`.
