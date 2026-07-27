---
'@skill-map/spec': minor
---

Adds `annotations.issueSuppressions` to the sidecar annotations schema: standing operator dismissals of deterministic analyzer issues keyed by (analyzer, value), applied at emission time (documented in db-schema §scan_issues together with the `data.target` value contract). The CLI contract gains the `sm issues dismiss / undismiss / suppressions` verb rows and the per-node issue dismiss/undismiss server routes.
