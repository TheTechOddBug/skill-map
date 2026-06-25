---
"@skill-map/web": patch
---

The demo graph now draws resolved trigger edges (mentions / invokes). `StaticDataSource.loadBranch` scoped link endpoints on the raw trigger `target` (`@agent`, `/cmd`) instead of the resolved node path, so those edges were dropped from the demo map; it now scopes on `resolvedTarget`, mirroring the live branch projection. Triggers a redeploy of the marketing site.
