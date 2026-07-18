---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Three inspector AI-actions fixes. The two-state finder button reflects its FIXER's job: `prob-extensions` computes `state` / `jobId` over `{finder} ∪ fixerIds`, so clicking Fix shows queued/running, not nothing. A plugin toggled mid-session is honored without restarting `sm serve`: the launcher and submit endpoints re-read the enabled set per request via a fresh resolver (drop-ins that booted disabled still need a restart). And the Automatic toggle is relabelled "Auto-fixer".

## User-facing

Clicking a finder's Fix now shows the fixer running instead of looking like nothing happened; enabling AI-action plugins takes effect without restarting the server; and the auto toggle is now labelled "Auto-fixer".
