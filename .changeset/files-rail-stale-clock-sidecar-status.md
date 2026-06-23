---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Restores the files rail's per-row stale-clock icon, dropped when the rail switched to building from the lightweight `GET /api/folders` payload (which carried the error / warn counts but not the sidecar drift status). The endpoint now emits a `sidecarStatus` field (the persisted `scan_nodes.sidecar_status`, `null` when there is no parseable sidecar), threaded from the kernel loader through the BFF into the rail so staleness flags corpus-wide in demo and `sm serve` mode.

## User-facing

The files rail again flags out-of-date nodes with the clock icon, so you can see at a glance which files have drifted since their last review.
