---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The node card's aggregate `warn` / `error` severity chips now sum both provenances: deterministic issues PLUS a node's unresolved, non-stale findings (open + `human-decision`). `issue-counter` and `sm scan` are unchanged; the findings are added at read time by the BFF node decoration under issue-counter's own chip ids, with a provenance-breakdown tooltip, on every endpoint that embeds contributions (`/api/nodes`, `/api/scan`, `/api/branch`).

## User-facing

A node's error/warning count on the map card now includes its AI findings, not just deterministic issues, so a node flagged only by an analysis run still shows a count. Hover the chip to see the split.
