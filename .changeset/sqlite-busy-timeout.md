---
'@skill-map/cli': patch
---

Set `PRAGMA busy_timeout` on every SQLite connection so a contended writer waits for a held write lock instead of failing immediately with `SQLITE_BUSY` ("database is locked"). Legitimate concurrent access (a second `sm serve`, a `sm scan` while the watcher is live, an editor-triggered rescan) now succeeds once the brief in-flight transaction commits, instead of surfacing a "watcher batch failed" warning.

## User-facing

**No more spurious "database is locked" errors.** Running `sm scan` while `sm serve` is watching (or two servers on one project) no longer fails with a database-locked error; the operations queue and complete.
