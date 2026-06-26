---
"@skill-map/cli": patch
---

Updated every outdated `src/` dependency to its latest exact pin and migrated the code the four major bumps required. The only runtime-touching change is js-yaml 4 to 5: importers switch to named `load`/`dump` with `schema: CORE_SCHEMA`, which emits byte-identical YAML 1.2 so canonical frontmatter and sidecar hashes are unchanged. TypeScript 6, @types/node 26, @hono/node-server and kysely 0.29 needed only build-config and type-cast tweaks. The bumps clear the known CLI-tree advisories.
