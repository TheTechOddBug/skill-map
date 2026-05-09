---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Two small wire enrichments that the new Settings modal needs:

**`GET /api/plugins` items now carry `description?: string`** — both at the bundle level and inside each `extensions[]` entry. The bundle's value is sourced from `IBuiltInBundle.description` for built-ins (now a required field on the type — every built-in bundle declares its summary inline at `built-in-plugins/built-ins.ts`) and from `plugin.json#/description` for user plugins. Each extension entry's value comes from its own manifest's `description` per `IExtensionBase` (`extensions/base.schema.json#/properties/description`). The SPA's Settings list renders the descriptions as muted secondary text and folds them into the substring-search index alongside the ids, so authors can ship discoverable copy without needing a separate docs round-trip.

**`GET /api/health` now carries `cwd: string` and `dbPath: string`** — both absolute. `cwd` is the project root the BFF resolves against (`runtimeContext.cwd`); `dbPath` mirrors `IServerOptions.dbPath`. The companion `db: 'present' | 'missing'` field still reports whether the file exists; the new fields tell the operator where to find it. Surfaced so the SPA's About panel can render "you are looking at <project>" plus the DB location without a second endpoint.

Both additions are forward-compatible: existing health clients ignore the new fields, and existing plugins UI consumers tolerate the absence of `description` (it's optional on the wire).
