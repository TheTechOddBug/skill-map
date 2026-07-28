---
"@skill-map/cli": patch
---

The project-preferences 412 consent envelope now carries the exposed folders as structured `error.details.paths` (new `ConfirmRequiredError` in the BFF), so the UI consent dialog for reference paths actually enumerates them instead of rendering an empty list. Also repairs the `--sm-text-muted` theme token (consumed in 36 places but undefined in light/dark/matrix, so muted text rendered at full strength), mirrors title-only settings badges for screen readers, and bumps Foblex Flow to 19.1.6.

## User-facing

**Consent dialog now lists the folders it would expose.** Adding a reference path outside your project shows the exact folders in the confirmation dialog instead of an empty list, and hint text renders properly muted again in the light, dark, and matrix themes.
