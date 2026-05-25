---
'@skill-map/cli': patch
---

Dev builds now SUPPRESS the version chip in two decorative surfaces and surface a lone `[dev]` marker instead:

- **SPA topbar**: the cyan `vX.Y.Z` chip next to the brand is replaced by the yellow `dev` chip when `/api/health.dev === true`. The chip's tooltip still surfaces the version for the bug-report flow (operator hovers, sees "Implementation v0.37.0").
- **`sm serve` banner**: the dim `vX.Y.Z` line under the figlet logo is replaced by a yellow `[dev]` marker (right-aligned, same column width so the layout stays in lockstep with the published case).

Rationale: when the operator is iterating on the source tree, the published version number names the last release, not what is actually running. Showing both `v0.37.0` and `dev` side by side is visually noisy and slightly misleading. `sm version` is intentionally NOT touched, that verb exists specifically to expose version data and still appends `[dev]` after the `sm` row.

## User-facing

In dev builds the topbar and the `sm serve` banner now show only the `dev` marker instead of pairing it with the published version number.
