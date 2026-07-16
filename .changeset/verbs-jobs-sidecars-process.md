---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The collection verb namespaces go plural (breaking, pre-1.0): `sm job` becomes `sm jobs` and `sm sidecar` becomes `sm sidecars`, aligning them with `plugins` / `actions` / `findings` under one rule (a browsed collection is plural). No singular alias. The queue-processing concept renames from "drain" to "process", and the agent skill is renamed `sm-run-queue` to `sm-process-jobs`.

## User-facing

`sm job ...` is now `sm jobs ...` and `sm sidecar ...` is `sm sidecars ...` (no old aliases, update scripts). The queue-processing skill is renamed `sm-process-jobs`; run `sm agent install` to get it.
