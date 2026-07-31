---
'@skill-map/cli': major
---

Plugin storage Mode B is gone: the dedicated-table wrapper, the plugin migration runner and its SQL namespace validator (793 lines) are removed, along with `sm db migrate`'s plugin pass and its `--plugin` / `--kernel-only` flags. The kernel migration half of that verb is untouched. A plugin manifest declaring `storage.mode: "dedicated"` is no longer valid; `mode: "kv"` is unaffected and keeps its four-method accessor.
