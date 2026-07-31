---
'@skill-map/spec': minor
---

The versioning policy no longer contradicts itself about conformance cases: three rules disagreed, and the strictest reading made every new case a major bump, freezing the suite at whatever size it had the day v1 shipped. Resolved from the principle the spec already stated (the suite VERIFIES the contract, it does not define it) in a new §Conformance suite changes table. `spec/index.json` also derives its whole catalog from the tree now, replacing hand-maintained blocks that had rotted.
