---
"@skill-map/spec": patch
---

Clarify the CLI contract's global-flags surface: the `-v` / `--version` row is now marked bare-invocation-only (it is an invocation path, not a per-verb option, so `sm scan -v` is an unknown-option error), and §Introspection states that parser- and boot-level entries (`--help`, `--log` / `--log-level`) publish in `globalFlags[]` only, never inside `verbs[].flags[]`.
