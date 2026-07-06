---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Move the web UI's "Live updates" and "Real-time node activity" preferences from browser localStorage to the project-local config: new `ui.liveUpdates` / `ui.realtimeActivity` keys in `project-config.schema.json` (project-local only, stripped from the committed layer), read and written through `GET/PATCH /api/project-preferences` and persisted in `.skill-map/settings.local.json`. The SPA loads them before opening the live socket; the former localStorage keys are simply no longer read.

## User-facing

The Live updates and Real-time node activity switches now live in Settings > Project and stick to the project instead of the browser: flip them once and every browser profile on this checkout sees the same choice.
