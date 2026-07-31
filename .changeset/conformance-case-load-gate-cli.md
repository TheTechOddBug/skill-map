---
'@skill-map/cli': minor
---

The conformance runner validates every case document against `conformance-case.schema.json` at load, before any scope is provisioned or child spawned; a malformed case fails with `case-invalid` naming the violation instead of surfacing as confusing downstream behaviour. A sweep test audits every bundled case in all six scopes, and the gate immediately caught three synthesized test cases missing a required field.
