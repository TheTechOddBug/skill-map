---
'@skill-map/spec': minor
---

Runners MUST validate every case document against `conformance-case.schema.json` before executing it, reporting a non-validating case as a named failure rather than proceeding into whatever its missing fields happen to produce. This is how the schema's own coverage row closes: a case can never assert it (the documents live outside the provisioned scope, and a case invoking the suite would recurse), so the load gate every case necessarily passes through is the enforcement point.
