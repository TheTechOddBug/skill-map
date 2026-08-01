---
'@skill-map/spec': minor
---

`ctx.log` gains `enabled(level)`, so an extension can skip building a message the level is about to discard: the argument to `trace(...)` is evaluated before any adapter can drop it, which makes an unguarded template inside a loop over the graph cost something on every scan. The guide documents the guarded shape and when it is unnecessary, and the CLI contract now states what each level is expected to surface.
