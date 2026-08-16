---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

New `DELETE /api/activity/sessions` endpoint: empties the session journal (every `.skill-map/sessions/*.json` plus the serve process's open in-memory buffers, one `activity.sessions-clear` operations line, always 204). The UI's delete-recording affordances (Settings row, replay transport trash) now call it together with clearing the browser tape, behind a single confirm that warns the observed-relations evidence for the next scan goes with it.

## User-facing

Deleting the recording now asks first and erases both memories in one gesture: the browser tape and the project's session journal on disk. The warning explains that "Observed in sessions" findings lose their evidence until new sessions are recorded.
