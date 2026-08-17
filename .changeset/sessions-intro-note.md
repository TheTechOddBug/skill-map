---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The Sessions tab gains a one-time intro note above the Record control stating what recordings are NOT (content-free: structure and timing, never prompts, file contents or results), dismissible machine-wide via the new `ui.dismissedNotes` list in the per-user settings file (`~/.skill-map/settings.json`), carried by the `GET`/`PATCH /api/preferences` envelope.

## User-facing

A small note above Record now explains that session recordings are content-free (what ran and when, never your prompts, files or results). Close it once and it stays closed on every project on this machine.
