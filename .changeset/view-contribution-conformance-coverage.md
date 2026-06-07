---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Harden test and conformance coverage for the emit-by-reference view-contribution refactor: orchestrator rejection-path and renderer unit tests, `sm plugins doctor` runtime-error coverage, two new conformance cases (renamed list payloads with off-shape rejections, and a manifest declaring all 14 slots) plus a fixture-drift fix. The conformance suite now runs in CI via `validate:test`, and the `plugins doctor` docs gain a runtime-error note. No CLI or normative spec change.
