---
'@skill-map/cli': minor
---

The `job.spawning` hook trigger is gone. It named the pre-spawn of a runner subprocess that the pull-only decision removed in July, and it outlived that removal in the runtime trigger list without ever being dispatched: a plugin could declare it, pass load-time validation, and never fire. The spec schema always listed the other nine, so this aligns the implementation with the published contract rather than changing it.
