---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Runtime contribution rejections (an undeclared ref, or a payload that fails the slot's schema) are now persisted per scan to a `scan_contribution_errors` table. `sm plugins doctor` prints a per-plugin "Runtime contribution errors" section and exits non-zero when any exist; `GET /api/plugins` embeds a per-plugin `runtimeContributionErrors[]` field the Settings panel renders as a warning badge plus a collapsible list. The `extension.error` scan event still fires.

## User-facing

`sm plugins doctor` now reports view-contribution errors from your last scan (and exits non-zero if any), and the Settings plugin panel shows a per-plugin warning badge with the failed emissions, so a plugin whose chips silently vanished now tells you why.
