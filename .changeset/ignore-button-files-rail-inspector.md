---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

The files rail's file and folder rows and the inspector header gain an Ignore button that appends a root-anchored pattern to the project-root `.skillmapignore` through the existing `PATCH /api/project-ignore`, fronted by a confirmation dialog whose don't-ask-again checkbox persists the new project-local `ui.confirmIgnore` key (default `true` = ask); duplicates resolve silently, demo mode hides the buttons, and the gesture rides telemetry as `ui.feature.ignore-path`, never the path.

## User-facing

**Ignore files without leaving the map.** Ignore a file or folder right from the files list or the inspector header: a new button adds it to `.skillmapignore` after a confirmation, with a don't-ask-again option. Bring it back anytime from Settings > Project.
