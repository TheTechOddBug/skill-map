---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The blanket `pluginTrust.projectEnabled` opt-in (the config key plus its Settings toggle that trusted every plugin the project enables) is removed. Plugin import trust is now per-plugin only: `sm plugins trust <id>` / the Settings Trust button, or `sm plugins trust --all` to trust every discovered drop-in at once. A single config toggle can no longer widen the local code-execution surface. Settings > Plugins also gains a consolidated restart notice when a drop-in changes trust or enable state.

## User-facing

The "Trust plugins this project enables" setting is gone. Trust plugins one by one (the Trust button, or `sm plugins trust <id>`), or run `sm plugins trust --all` to trust them all. Settings now shows a clear "restart to apply" notice after a plugin trust or enable change.
