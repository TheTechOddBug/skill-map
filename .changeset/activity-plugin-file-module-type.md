---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`sm activity install` for `plugin-file` providers (opencode-style) now writes an ESM-pinning `package.json` (`{ "type": "module" }`) next to the generated in-process plugin so the vendor runtime loads its `export`-based `.js` without a `MODULE_TYPELESS_PACKAGE_JSON` warning (or a hard parse error under a CommonJS host). Written only when the plugin dir has no `package.json` (never clobbering the vendor's shared dir); uninstall removes it only when it is exactly ours.

## User-facing

`sm activity install` now drops a small package.json next to a plugin-file provider's hook so your tool loads it without a module-type warning. It won't overwrite a package.json already in that folder.
