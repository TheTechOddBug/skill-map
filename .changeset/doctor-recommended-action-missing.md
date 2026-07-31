---
'@skill-map/cli': minor
---

`sm plugins doctor` gained the `recommended-action-missing` warning the spec already promised: an action whose `precondition.analyzerIds` names an analyzer no loaded plugin declares now surfaces a non-blocking diagnostic instead of failing silently. Resolution spans the whole registry, so a cross-plugin reference is fine. The `applicable-kind-unknown` warning is renamed `precondition-kind-unknown` after the field it actually reads, and gained the tests it never had.
