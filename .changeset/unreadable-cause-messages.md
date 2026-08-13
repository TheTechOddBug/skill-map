---
'@skill-map/cli': patch
---

The unreadable-node submit refusal now diagnoses and names the actual cause instead of a generic "file missing or not readable as a node": a deleted file, a broken symlink, permission denied, or an external symlink blocked by settings, each with the remedy that applies to it (the old blanket "run sm scan" advice was wrong for half of them). The full sentence is authored once in the submit engine, so the CLI, the fan-out lines, the BFF envelope, and MCP `submit_job` all carry it.

## User-facing

When a job submit fails because a file cannot be read, the error now tells you what actually happened (deleted, broken symlink, no permission, or a link blocked by settings) and how to fix that, instead of a generic message.
