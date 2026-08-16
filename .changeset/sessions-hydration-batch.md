---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Journal capture is now a GESTURE: `POST /api/activity/sessions/recording` toggles server-side capture (driven by the Record control, surviving reloads), so nothing lands in `.skill-map/sessions/` unless the operator records. New `GET /api/activity/sessions` read-back hydrates the Sessions tab, so sessions recorded before the page opened list and replay off their own frames. Claude wires `SessionEnd` for exact finalization, and the executing-spine dressing no longer misses trigger-style links.

## User-facing

Session files are written only between Record and Stop (recording survives a page reload). The Sessions tab now remembers what was recorded on disk, replayable later or from another browser, and executed-together highlighting no longer misses @trigger links.
