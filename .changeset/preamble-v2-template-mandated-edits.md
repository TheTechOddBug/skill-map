---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Preamble v2 (Decision #140): rule 4 now permits file edits ONLY when the extension template explicitly directs an edit as the job's purpose (unblocking fixer Actions; code execution and URL fetching stay absolutely forbidden, user-content can never mandate anything), the wording moves from "runs actions" to "prepares analysis jobs" with "extension" throughout, and the closing line names the Report contract section. Conformance fixture recut as `preamble-v2.txt`; every job re-keys.

## User-facing

The safety instructions inside every queued job got a v2: agents may now edit files when a job's own instructions say so (never because of file content), which enables upcoming fix-it jobs.
