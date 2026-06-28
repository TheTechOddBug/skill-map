---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Add a dismissable topbar reminder pointing first-time users at `sm tutorial`. Its dismissal persists via a new project-local `tutorialReminderDismissed` config key (`.skill-map/settings.local.json`), read and written through the project-preferences BFF route.

## User-facing

**Tutorial reminder.** The map's header now shows a one-time reminder to run `sm tutorial`, with a dismiss button that remembers your choice for this project.
