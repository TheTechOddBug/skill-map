---
"@skill-map/cli": patch
---

Enabling the project plugin-trust toggle in Settings now surfaces a restart warning (a `p-message` banner under the row plus a note on its own line in the trust confirm dialog), the workspace files-follow toggle uses a clearer swap icon, and user-facing strings that pointed at `sm serve` now use the bare `sm` alias across settings, inspector, server advisories, activity hints, and the `sm example` next-steps.

## User-facing

Turning on "Trust plugins this project enables" in Settings now reminds you to restart so the change takes effect, and hints across the app and CLI now show the bare `sm` command instead of `sm serve`.
