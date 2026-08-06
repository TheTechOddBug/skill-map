---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

The liveness probe no longer targets a project file. A probabilistic Action can now declare `probNodeless`: submits skip target resolution and drift verification and enqueue against a synthetic `sm://<extension-id>` id, through the new `POST /api/jobs` or `sm jobs submit <ext>` with no `-n`. `core/ai-ping-action` declares it, so a question about the AGENT stops failing when the file it happened to aim at was deleted since the last scan. The claim / record circle is unchanged.

## User-facing

Checking whether an agent is answering no longer fails with a "cannot be read from disk" error when a file in the map has been deleted, and now works in a project you have not scanned yet.
