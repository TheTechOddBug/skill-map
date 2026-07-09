---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`sm plugins create` now emits a root `package.json` (`{ "private": true, "type": "module" }`) so Node loads a plugin's ESM `.js` extensions without the `MODULE_TYPELESS_PACKAGE_JSON` warning, and `sm plugins upgrade [<id>]` backfills it on older plugins (adding a missing `type` without clobbering a non-module one). The plugin author guide documents the module-type requirement and the Provider `activity` capability, and the quickstart adds the `sm plugins trust` step.

## User-facing

New drop-in plugins now ship a package.json so Node loads them without a module-type warning. Run `sm plugins upgrade` to add it to plugins you created earlier. The plugin docs now cover the trust step and how a provider wires live activity.
