---
'@skill-map/cli': minor
---

The Mode A plugin KV store now exists and is wired. `ctx.store` exposes the four methods `plugin-kv-api.md` has always required (`get` / `set` / `delete` / `list`) over `state_plugin_kvs`, scoped per plugin and optionally per node, behind a new `pluginKvs` storage port. Until now only `set` existed and nothing populated `ctx.store`, so it was `undefined` on every real scan; a regression test drives an extractor through `runScan` to pin the wiring itself.
