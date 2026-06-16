---
"@skill-map/cli": patch
---

Remove a dead per-node aggregation loop from the `annotation-field-unknown` analyzer: it counted offending keys per node for a card chip that was already retired, then discarded the result via `void`. No behavior change; the emitted findings are unchanged.
