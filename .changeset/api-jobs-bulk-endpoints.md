---
"@skill-map/spec": minor
---

Add `POST /api/jobs/cancel-all` and `POST /api/jobs/prune[?status=]`, the bulk write endpoints behind the queue inspector toolbar. cancel-all moves every queued/running job to terminal cancelled and broadcasts one `job.cancelled` per id; prune deletes terminal jobs immediately (all terminal states, or just one via `?status=completed|failed|cancelled`) as a silent GC with no WS event. A non-terminal or unknown status returns `400 bad-query`. Additive; route rows land in `cli-contract.md`.
