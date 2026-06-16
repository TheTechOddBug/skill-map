---
"@skill-map/cli": patch
---

Fix a stale doc comment in the `annotation-orphan` analyzer: the header claimed `nodeIds` is empty, but the analyzer sets it to the orphan's would-be `.md` path (the missing sibling, to satisfy the issue schema's `minItems: 1`). Comment-only; no behavior change.
