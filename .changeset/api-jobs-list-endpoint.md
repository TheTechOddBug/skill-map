---
"@skill-map/spec": minor
---

Add `GET /api/jobs?status=&extension=&node=`, the cross-corpus job-queue list read endpoint (HTTP face of `sm jobs list`), plus a new registry-less `kind: 'jobs'` list variant in the REST envelope schema. Each row is a public `Job` projection carrying every field except the `nonce`, all three filters are optional, and an unknown `status` value returns `400 bad-query`. Additive API surface; a route row lands in `cli-contract.md`.
