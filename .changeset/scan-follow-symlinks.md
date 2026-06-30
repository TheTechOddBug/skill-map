---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Add an opt-in `scan.followSymlinks` setting (default `false`). When enabled, the scan walker follows symlinked directories and files instead of skipping them, so a softlinked `.claude/skills` is indexed. Following is gated by cycle detection and realpath containment (a link is followed only when its target stays inside the scan roots), and the incremental watcher re-scan applies the same policy as a full scan.

## User-facing

**Scan symlinked folders.** Turn on `scan.followSymlinks` in settings to index skills behind a symbolic link (for example a `.claude/skills` that points elsewhere). Off by default; links pointing outside your project are never followed.
