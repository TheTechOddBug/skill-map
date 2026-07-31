---
'@skill-map/spec': minor
---

The conformance case format gained its last two primitives: `parallel` on the main invocation spawns N identical invocations concurrently (with set-level assertions `parallel-exit-codes` and `parallel-json-path-count`, since "the" result is ambiguous across a race), and `sleepAfterMs` on staged steps makes TTL expiry observable. The atomic-claim race and the reap are now conformance cases: one handover and one refusal in either order, and an expired running job surfacing as `failed / abandoned`.
