---
'@skill-map/cli': patch
---

Fix: the inspector's Activity tab now refreshes its AI-run history live on job completion. It subscribed only to runtime frames (`node.activity`, `agent.spawn`) and re-scans, but `sm record` closes an AI job by pushing `job.completed` (no `node.activity`), so a run that changed no file (finder or summarizer) did not surface until an unrelated refresh fired. The Activity refresh now also merges the job-event stream, so a finished AI run appears immediately.

## User-facing

The inspector Activity tab now shows a finished AI review right away, even when the run did not change any file (finder or summarizer runs); before, those sometimes only appeared after navigating away and back.
