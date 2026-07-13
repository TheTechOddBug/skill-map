---
"@skill-map/spec": minor
---

The `sm doctor` contract section now pins the error-level vs warning split (DB corruption and missing job-content rows are the two error-level findings) and the `--json` envelope: `{ ok, kind: 'doctor', checks[] }` with one `{ id, status, message }` entry per check over the closed eight-check id vocabulary.
