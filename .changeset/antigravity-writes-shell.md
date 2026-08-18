---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The antigravity live-activity adapter maps markdown writes and joins the shell capture rung: `write_to_file` / `replace_file_content` emit write signals (both carry an absolute `TargetFile`, live-characterised on agy 1.1.14), and the opt-in `run_command` hook yields shell path sightings resolved against the command's own `Cwd`. The spec's antigravity row also documents the workspace-trust gate (hooks load only for trusted folders).

## User-facing

On Antigravity, file edits now light the map as writes, and shell capture is available: opt in with `sm activity install antigravity --shell`, pick the Shell level, and .md files named in terminal commands show up in recordings.
