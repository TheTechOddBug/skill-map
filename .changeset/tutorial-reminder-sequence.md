---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The web UI's topbar tutorial reminder now shows two messages in sequence instead of one: a Quick Start nudge first, then the `sm tutorial` nudge, one dismiss advancing to the next. The project-local config key backing it changed shape from the boolean `tutorialReminderDismissed` to the integer `tutorialReminderStep` (0-2); `GET`/`PATCH /api/project-preferences` reflect the new key.

## User-facing

The "New to skill-map?" topbar reminder now shows a Quick Start tip first, then the `sm tutorial` tip on your next visit after dismissing it.
