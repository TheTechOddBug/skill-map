---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

The agent-liveness verdict now waits for the ANSWER instead of the claim. A `job.claimed` is a receipt: an agent parked on `sm jobs claim --wait` picks a job up within one poll cycle, so the Check probe and `GET /api/agent/presence` both reported "an agent is answering" before the model had read a line of the prompt. Only `job.completed` / `job.failed` count now; a claim moves the check into a second phase with its own longer window, and a claimed-but-unanswered ping reports that distinctly.

## User-facing

The "Agent waiting for jobs" check no longer turns green the instant your agent picks the ping up. It waits for the agent to actually answer, shows "picked it up, waiting" in between, and tells you when something took the job but never came back.
