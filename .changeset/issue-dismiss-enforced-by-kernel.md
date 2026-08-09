---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Dismissing a deterministic analyzer issue now sticks across scans for every analyzer, not just `core/reference-broken`. The orchestrator applies `annotations.issueSuppressions` centrally, dropping any emitted issue whose `(analyzer, data.target)` pair matches an entry on one of its anchor nodes before it reaches the accumulator; `core/reference-broken` keeps its inline check only to skip the confidence penalty.

## User-facing

Dismissing an issue used to work only for broken references: for every other kind (redundant references, self-loops, reserved names, schema violations, extractor collisions) the issue came back on the next scan. Dismissals now stick for all of them.
