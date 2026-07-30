---
'@skill-map/cli': minor
---

The plugin KV store now enforces a hard 4 MiB budget per plugin per scan, rejecting the write that would cross it with `KvBudgetExceededError` and persisting nothing. The per-value 1 MiB ceiling bounded nothing on its own, since an Extractor runs once per node and a plugin on a large tree could stay under it on every call while growing the project database without limit. A rejected write does not consume budget, so the plugin is throttled rather than bricked, and the scan continues.
