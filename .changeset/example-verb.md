---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

New `sm example` verb: drops a ready-to-explore example project (the same wired harness the public demo renders) into an empty directory, so a new user can run `sm scan` then `sm serve` against a real connected graph without authoring files first. The payload is the single canonical `fixtures/demo-scope/` fixture, shared with the web demo, and ships unscanned (no `.skill-map/`). Refuses a non-empty cwd unless `--force`.

## User-facing

New `sm example` command: run it in an empty folder to drop a small ready-made project, then `sm scan` and `sm serve` to explore it as a live graph. The fastest way to try skill-map without setting up your own files first.
