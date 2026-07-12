---
"@skill-map/cli": minor
---

Adds the first slice of the Step 10 job queue: real `sm job submit`, `list`, and `show` over the DB-only content-addressed store (`state_job_contents` keyed by `content_hash`). `submit` renders the preamble plus action template, folds `node.path` into the content hash, resolves TTL/priority/nonce, and writes the content and job rows in one transaction, with duplicate detection, `--all` fan-out, and `--force`/`--ttl`/`--priority` flags. No runner, claim, or record yet.
