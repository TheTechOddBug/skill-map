---
"@skill-map/spec": minor
---

New `cli-contract.md` §Operations log: every mutating operation appends one JSONL line to the gitignored `.skill-map/operations.log` (`{at, op, target, extension?, channel, outcome, id?/detail?}`), fire-and-forget, silent without a `.skill-map/` directory, single-generation 1 MiB rotation. The REST envelope schema's value-envelope variant gains the `config.resolution` kind backing the new `GET /api/config/resolution` route.
