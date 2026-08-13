---
'@skill-map/cli': patch
---

The Live lens replay tape now survives a reload: the recorder mirrors it into localStorage (`sm.live.recording`) and hydrates at boot, so a refresh or a later visit keeps the history. Nothing expires it by age; the operator owns its lifetime through a new Settings row (with an events + size readout) and a delete shortcut in the replay bar. The mirror is double-bounded by event count and characters so it can never crowd the other stored preferences out of the origin quota.

## User-facing

Your session recording now survives a page refresh, and it stays until you delete it: Settings, Project shows how much is stored with a Delete button, and the replay bar carries the same shortcut.
