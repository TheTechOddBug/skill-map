---
'@skill-map/spec': minor
---

The conformance case format gained four optional fields that make previously inexpressible contracts testable: `schemaPointer` and `each` on both schema assertions, targeting a `$def` inside a schema and validating every element of a list surface, plus `expectExit` and `capture` on `setup.priorInvokes`, staging a step that must be refused and binding a runtime-minted value into later invocations. Ten coverage rows closed as a result.
