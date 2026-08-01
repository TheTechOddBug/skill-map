---
"@skill-map/cli": patch
---

`sm help` (json / md) now publishes the boot-level `--log` / `--log-level` global flag, closing an introspection gap; `sm check` renders unknown `--analyzers` ids as the standard error-plus-hint block; `sm scan --help` describes the active-provider-lens pipeline instead of the retired fixed extension set; stale `-v` verbosity mentions in docstrings now say `--log`; and the unused `typanion` dependency is gone.

## User-facing

`sm help` now lists the `--log` / `--log-level` flag, `sm scan --help` describes the current scan pipeline, and mistyping an analyzer id on `sm check --analyzers` shows the usual error style with the valid ids right below.
