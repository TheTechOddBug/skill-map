---
'@skill-map/cli': minor
---

The conformance runner implements `setup.serve`, `http-matches-schema` and `ndjson-line`. The serve child is spawned with `--no-watcher` on port 0, readiness is polled on `serve.json`, and teardown is an awaited SIGTERM with a SIGKILL fallback inside the same finally that removes the scope, so the child can never outlive the case. HTTP assertions carry a 10s abort timeout, and declaring one without `setup.serve` fails the case loudly as an authoring error instead of skipping.
