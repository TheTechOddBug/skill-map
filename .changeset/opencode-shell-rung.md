---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The shell capture rung reaches opencode through a plugin-file opt-in dialect: the generated activity plugin carries a `{{SHELL_ON}}` wiring filter resolved at install render, so bash command lines never leave the host process until `sm activity install opencode --shell` re-renders it (closing a posture gap where bash events were forwarded and discarded server-side); once opted in, `.md` paths in bash commands land as shell sightings. All four activity providers now own the rung.

## User-facing

Shell capture now works on OpenCode too: opt in with `sm activity install opencode --shell`, pick the Shell level, and .md files named in shell commands light the map. Without the opt-in, command lines now never leave the OpenCode process at all.
