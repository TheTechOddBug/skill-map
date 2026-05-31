---
"@skill-map/cli": minor
---

The plugin loader now rejects a disk-loaded extension manifest that re-declares a structure-as-truth field (`id`, `kind`, provider `kinds`, formatter `formatId`) as `invalid-manifest` instead of silently stripping it. These are derived from the folder layout, so declaring one was a second source of truth that could drift. `pluginId` is unchanged. `sm plugins create` no longer emits `kind` in the stub. Breaking for external plugins that inlined any of these fields.
