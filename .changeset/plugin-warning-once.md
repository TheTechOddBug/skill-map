---
'@skill-map/cli': patch
---

Plugin-load warnings are emitted exactly once per `sm serve` boot. The composition root is now the single emission point (it used to gate its own line behind `--no-watcher` while two route factories printed the full warning list at registration time), so a project carrying an untrusted drop-in no longer repeats the "found but not loaded" notice at startup.

## User-facing

Starting `sm` on a project with an untrusted plugin now prints the "plugin found but not loaded" warning once instead of twice.
