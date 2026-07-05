---
"@skill-map/cli": patch
---

Fatal command failures now emit their error text via `printer.error()` (stderr) instead of `printer.info()`, so `--json` / `--quiet` runs no longer exit non-zero with no explanation (44 sites across 9 commands); the `core/update-check` hook receives the update probe injected through the `boot` event payload instead of importing it from `cli/`, and two new lint guards block regressions on both fronts.

## User-facing

**Failed commands now always say why.** When an `sm` command fails, the error message is printed even with `--json` or `--quiet`; previously some failure paths exited with a non-zero code and no explanation.
