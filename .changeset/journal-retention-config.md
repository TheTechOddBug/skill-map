---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The session-journal retention ceilings are now project-config keys beside the master switch: `activity.journal.maxFiles` (default 50) and `activity.journal.maxTotalBytes` (default 20 MiB), read once at serve boot and applied oldest-first at boot and each finalization. The journal is the evidence window the observed-* volume gates count against, so keep `maxFiles` at or above the largest `min-active-sessions` in use.

## User-facing

You can now decide how many recorded sessions the project keeps (`activity.journal.maxFiles` / `maxTotalBytes` in settings.json): raise them if your never-runs detector needs a longer memory than the default 50 sessions.
