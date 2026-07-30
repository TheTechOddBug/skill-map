---
'@skill-map/spec': minor
---

`plugin-kv-api.md` gains an aggregate storage budget alongside the per-value ceiling, with `KvBudgetExceededError` for the write that crosses it. The two are deliberately distinct: the per-value limit is about one value being too big, while the budget catches many individually-legal writes adding up, which is the shape a plugin looping over every node produces.
