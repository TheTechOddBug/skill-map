---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

The `node.prob-extensions` entry gains an optional `findingsMaxSeverity` (highest OUTSTANDING severity for the pair, `null` when nothing is pending). The inspector renders it as a per-launcher verdict mark, the Findings card gains severity filter chips, a Dismiss-all over the visible AI findings and a Delete-all over a revealed bucket, its rows sort error before warn before info, the header shows the node's tokens and bytes, and the queue lists jobs in strict enqueue order.

## User-facing

Findings filter by severity and dismiss (or permanently delete) in one click, and each AI action shows what it still has pending, turning into a green check once everything is resolved. The queue lists newest jobs first, and the inspector header shows the file's tokens and bytes.
