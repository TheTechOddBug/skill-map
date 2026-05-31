---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Normalize plugin terminology: "bundle" is no longer used as a synonym for "plugin". The installable unit is now consistently called a "plugin" everywhere (types, identifiers, spec prose, CLI output, and Settings labels); the word "bundle" is reserved exclusively for the aggregate toggle that flips all of a plugin's extensions at once (the "bundle macro"). No behavior or wire-shape changes.

## User-facing

`sm plugins list` / `show` and the Settings → Plugins UI now consistently say "plugin" instead of "bundle". The only place "bundle" remains is the name for toggling a whole plugin (all its extensions) at once.
