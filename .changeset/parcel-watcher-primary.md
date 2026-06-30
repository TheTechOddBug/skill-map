---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Make the primary scan watcher backend selectable via `scan.watch.backend` (`auto` default, `parcel`, `chokidar`). `auto` uses `@parcel/watcher` (a single native inotify instance that scales to huge trees without chokidar's `EMFILE` failure) and switches to `chokidar` when `scan.followSymlinks` is on so symlinked dirs keep updating live. The meta-watcher stays on chokidar. Defaults preserve existing behaviour.

## User-facing

**Watcher scales to large repos.** The file watcher now uses a native single-instance backend, so `sm serve` / `sm watch` no longer crash with `EMFILE: too many open files` on projects with very many folders. Set `scan.watch.backend` (auto / parcel / chokidar) to force a backend.
