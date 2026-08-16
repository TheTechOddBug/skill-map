---
'@skill-map/spec': minor
---

New `session-recording.schema.json` (the per-session activity journal envelope, content-free frames of the WS wire shapes) plus its contracts: `provider-activity.md` gains the Session journal section, `architecture.md` adds `.skill-map/sessions/` as the fifth Storage-rule home, `cli-contract.md` adds the `activity.session-write` operations slug and the `sessions/` scope-ignore entry, and `project-config.schema.json` adds `activity.journal.enabled` (default true).
