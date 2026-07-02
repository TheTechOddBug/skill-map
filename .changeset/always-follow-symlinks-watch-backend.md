---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Remove the `scan.followSymlinks` setting: the scan walker now always follows symbolic links, to targets inside or outside the project, guarded only by cycle detection (the realpath-containment gate is gone). Change `scan.watch.backend` to `chokidar` (default) or `parcel` and drop the `auto` value, and add a `--watch-backend <chokidar|parcel>` flag on `sm serve` / `sm watch` / `sm scan --watch` that overrides the setting per invocation.

## User-facing

Symlinked folders are now always indexed, even when the link points outside your project. The file watcher defaults to `chokidar`; pass `--watch-backend parcel` on `sm serve` / `sm watch` for very large trees (scales better, but no live updates behind symlinks).
