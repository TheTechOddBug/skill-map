---
'@skill-map/cli': patch
---

Internal: bump `tsx` from 4.21.0 to 4.22.3. The 4.21.1 release added official support for Node 26.1.0 (switched the loader from the now-deprecated `module.register()` to `module.registerHooks()`), so dev-mode invocations under Node 26 no longer print the `DEP0205` deprecation banner at startup. Node 24 floor (`engines.node >= 24.0`) is unaffected: tsx 4.22.3 retains the legacy path on older Node versions. Touches `src/package.json` and the workspace lockfile only; no runtime behavioural change for the built CLI distribution.
