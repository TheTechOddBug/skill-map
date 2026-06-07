---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Plugins can now contribute action buttons to the inspector: a new `inspector.action.button` slot renders buttons that dispatch a kernel Action via `POST /api/actions/:id`, and the two header badge sub-slots collapse into one `inspector.header.badge` slot. The `.sm` write consent splits into `confirm` (one-shot) and `always` (persists `allowEditSmFiles`). `core/annotation-stale` now emits the Bump button and stale badge as contributions instead of hardcoded UI.

## User-facing

The inspector now renders the Bump button and the stale indicator from a plugin instead of hardcoded UI. Writing a `.sm` sidecar now asks for consent every time, with an "always allow" checkbox that persists the permission for the project.
