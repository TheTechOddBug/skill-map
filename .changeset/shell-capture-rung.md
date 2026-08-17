---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The capture ladder's `shell` rung is real, behind a double opt-in: `sm activity install claude --shell` persists the project-local `activity.shellCapture` key and renders an extra `PreToolUse` Bash hook (`--no-shell` retires it), and `POST /api/activity/capture-level` refuses `shell` while the key is off. Bash commands naming in-scope `.md` files yield heuristic path sightings (`access: "shell"`); the command text itself is never captured. Claude-only for now.

## User-facing

Recordings can now spot docs touched from shell commands: opt in with `sm activity install claude --shell`, then pick the Shell capture level. Only file paths are kept, never the commands themselves, and the fifth selector position stays locked until you opt in.
