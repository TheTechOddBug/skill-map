---
"@skill-map/spec": minor
---

The findings REST envelope honesty counts reduce to the `dismissedExcluded` / `fixedExcluded` pair (stale rows now ride `items` inline, flagged per row, with `?stale=1` demoted to a narrowing filter), the serve route table adds `DELETE /api/nodes/:pathB64/findings/:id` (per-row hard delete that also lifts a last-row suppression), the activity summary gains `runNodes` (persistent-run node list), and `annotation-stale` emits card contributions only, no issue (conformance case updated).
