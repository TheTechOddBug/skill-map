---
'@skill-map/cli': minor
---

Clipanion's built-in version command claimed `-v` as well as `--version`, so `sm -v` printed the version and `sm -v <verb>` died with "unknown command", and any global flag typed before the verb was swallowed into `sm serve`. `-v` is the verbose counter everywhere now. The UI's bump chain listened for a WS event the server no longer emits, so an inspector bump refreshed nothing; it consumes `action.applied` now. `sm history --extension` also takes a bare id again.

## User-facing

`sm -v scan` and `sm --json version` now work: `-v` used to print the version instead of raising the log level, and a flag typed before the verb failed with a confusing "serve" error. Bumping a node from the inspector also refreshes the view again.
