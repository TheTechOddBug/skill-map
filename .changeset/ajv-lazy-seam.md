---
'@skill-map/cli': patch
---

AJV now loads lazily through a synchronous `createRequire` seam in the kernel's ajv-interop helper (every construction site was already function-local, so no signatures changed), stays external to the dist bundle, and the user-settings store validates `~/.skill-map/settings.json` against its own single compiled schema instead of the full spec validator catalog. The five bundled boot deps (clipanion, smol-toml, js-yaml, semver, ignore) moved to devDependencies; installs no longer download them.
