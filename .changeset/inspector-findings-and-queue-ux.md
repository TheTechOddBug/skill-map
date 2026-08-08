---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The `node.prob-extensions` entry gains an optional `findingsMaxSeverity` (highest stored-finding severity for the pair, `null` when the extension left no rows). The inspector renders it as a per-launcher verdict mark, the Findings card gains severity filter chips plus a Clear-all that row-dismisses the visible AI findings and sorts rows error before warn before info, the header shows the node's tokens and bytes, and the queue lists jobs in strict enqueue order.

## User-facing

Findings now filter by severity and clear in one click, and each AI action shows what its last run found (green check when it found nothing). The queue lists newest jobs first, and the inspector header shows the file's tokens and bytes.
