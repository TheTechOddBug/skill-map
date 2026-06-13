---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Extensions declaring `stability: 'deprecated'` now also ship DISABLED by default, joining `experimental` in the ships-disabled set: a deprecated extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override), the same opt-in `experimental` uses. `beta` / `stable` keep running. No built-in is deprecated today, so the default scan is unchanged until one is marked.

## User-facing

Deprecated plugin extensions now start **disabled**, like experimental ones: they show an off toggle (with the deprecated badge) in Settings and `sm plugins list`, and don't run until you enable them. Enabling one keeps it working while you migrate off it.
