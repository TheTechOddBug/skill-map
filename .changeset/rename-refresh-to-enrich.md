---
'@skill-map/spec': minor
---

Renames `sm refresh` to `sm enrich`: every other name in that subsystem already said "enrichment" (`node_enrichments`, `state_enrichments`, the `enrichments/` schema folder), and `refresh` collided with the unrelated `sm sidecars refresh`. `refresh-report.schema.json` becomes `enrich-report.schema.json` and its envelope kind `refresh.report` becomes `enrich.report`. The Scan section now states the scan-vs-enrich layer split and why no single-node scan exists.

## User-facing

`sm refresh` is now `sm enrich`, a name that says what it does: refresh the enrichment layer of an already-scanned node. The old name is gone, not deprecated.
