---
"@skill-map/cli": minor
---

Two built-in finder Analyzers complete the wave-1 roster: `core/ai-contradiction-analyzer` (directive pairs that cannot both be followed, or whose combination is jointly risky) and `core/ai-incoherence-analyzer` (dangling references, drifting terminology, steps out of order). Same mold as `core/ai-redundancy-analyzer`: probabilistic, stable and enabled by default, each report schema narrowed to its own finding type; finders judge independently.

## User-facing

Two new AI reviews for your files, on by default: contradiction (including risky directive combinations) and incoherence detection. Queue with `sm job submit`, read results with `sm findings`.
