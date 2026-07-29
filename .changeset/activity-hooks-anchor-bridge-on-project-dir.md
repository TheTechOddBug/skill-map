---
'@skill-map/cli': patch
---

`sm activity install claude` wrote the bridge path cwd-relative (`node .skill-map/activity/bridge.js claude`) on the premise that hooks always spawn at the project root, so an agent that changed directory mid-session made every later hook die with `MODULE_NOT_FOUND`. The `json-hooks` install descriptor gains an optional `projectDirEnvVar` and Claude declares `CLAUDE_PROJECT_DIR`, so the command anchors on the runtime variable. Codex and Antigravity keep the relative form.

## User-facing

**Claude Code activity hooks survive a change of directory.** Live-activity hooks no longer stop working once the agent moves into a subfolder of your project. If you installed them already, re-run `sm activity install claude` to pick up the new wiring.
