---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

New `core/declared-link-unobserved` analyzer, the dead-design detector: one `info` issue per declared `invokes`/`references` link that recorded sessions could have observed firing (target an `mcp://` or agent node) but never did, gated on the source having executed at least 3 times (`IAnalyzerContext.observedExecutions`, the journal fold's new per-node run counts). Rows join "Observed in sessions" in the inspector; dismissible, no auto-fixer.

## User-facing

skill-map now questions your design in both directions: besides pointing out what your agents used without you mentioning it, "Observed in sessions" also flags declared references that never fired across enough recorded sessions, so you can prune or rework stale links.
