---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Antigravity joins live activity: the contract gains three additive install-descriptor fields (`install.group`, `install.commandCwd`, `events[].entryShape`) and a node-less owner-release signal form, the bridge derives its scope root from its own installed location instead of the spawn cwd, and the new adapter lights everything the agent reads via `view_file` and releases the whole chain on conversation `Stop` (demo fixture: `fixtures/realtime-antigravity/`).

## User-facing

**The live map now works with Antigravity.** Run `sm activity install antigravity` and watch skills, workflows and notes light up as the agent reads them, going dark the moment it finishes. Skills invoked with a slash stay dark (Antigravity reports no event for them).
