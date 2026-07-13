---
"@skill-map/cli": minor
---

New built-in `github/enrichment` (ships disabled; enable it from Settings → plugins): `sm refresh` verifies a node's local body against its declared upstream (`source` + `sourceVersion` annotations), via the immutable raw URL for SHA pins or API ref resolution otherwise, and records the verdict in `state_enrichments`. Requires the `allowNetworkActions` project policy; an optional `token` secret setting raises GitHub API limits.

## User-facing

**Know when your copied skills drift from upstream.** Annotate a node with its GitHub `source`, enable the GitHub plugin and `allowNetworkActions`, and `sm refresh` tells you whether your local copy still matches the original.
