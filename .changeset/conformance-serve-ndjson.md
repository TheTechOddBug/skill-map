---
'@skill-map/spec': minor
---

The conformance case format gained the server-capable primitives: `setup.serve` boots the implementation's server on an ephemeral port (readiness via `serve.json`, held up through assertion evaluation), `http-matches-schema` validates a REST response, and `ndjson-line` asserts one line of an ndjson stdout stream. Three more coverage rows closed, including one whose deferral note had the blocker exactly backwards.
