---
'@skill-map/spec': minor
---

`plugin-kv-api.md` gains `KvNodePathInvalidError`: an empty `nodePath` is now rejected rather than routed to global scope, because the empty string is the internal sentinel for global and accepting it would make a write that said "node-scoped" read back as global, collapsing every per-node row into one.
