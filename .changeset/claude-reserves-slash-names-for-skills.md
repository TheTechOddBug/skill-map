---
"@skill-map/cli": patch
---

Reserve the claude built-in slash names under `skill` as well as `command`. The two kinds share the `/` invocation namespace (`invokes: ['command','skill']`), so a built-in like `/help` shadows a user skill named `help` just as it shadows a command; the list is extracted to a shared `RESERVED_SLASH_NAMES` const. The `core/name-reserved` warnings are reworded around "Name collision: ..." so the operator reads what happened instead of internal shadowing terms.

## User-facing

**Skills that shadow a built-in slash command are now flagged.** A skill named like a built-in (e.g. `/help`) is reported as a name collision, the same as a command was, and the collision warnings are reworded to read more plainly.
