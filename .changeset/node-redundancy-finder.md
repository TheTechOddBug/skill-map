---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

First built-in finder Analyzer: `core/ai-redundancy-analyzer` (probabilistic, experimental, ships disabled) judges a node for internal redundancy through the job queue and lands `type: redundancy` rows in `state_findings`; its report schema narrows the finding type so the finder can only emit its own judgment. The spec gains the `findings-contract` / `findings-contract-kind` conformance pair covering the rendered findings-envelope report contract and the frozen `extensionKind: analyzer` job row.

## User-facing

New optional AI review that flags repeated instructions inside a file: enable `core/ai-redundancy-analyzer`, queue it with `sm job submit ai-redundancy-analyzer`, and read the judgments with `sm findings`.
