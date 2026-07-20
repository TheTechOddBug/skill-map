---
"@skill-map/cli": patch
---

Fix orphaned design-token references in the bundled UI and align its TypeScript with the CLI workspace (6.0.3). Custom CSS referenced tokens no theme ever emitted (`--p-warn-color`, `--p-danger-color`, bare `--p-border-radius`, a `--p-primary-color-300` typo), so those elements silently lost radius, colors, or glow; they now use the project's `--sm-severity-*` / `--sm-radius-md` tokens and the real `--p-primary-300`. Toggle buttons swap the deprecated `styleClass` input for `class`.

## User-facing

Small visual fixes: some banners and chips recover rounded corners and warning colors that a stale style reference had silently dropped, and the selected-node glow on the map is back.
