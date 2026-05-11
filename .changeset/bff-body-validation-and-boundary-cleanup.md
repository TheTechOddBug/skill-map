---
"@skill-map/cli": patch
---

Apply four P1 findings from the cli-architect audit on `src/` — three are pure internal refactors (no observable behaviour change), one tightens BFF input validation.

**A1 — move `assertContained` to `core/paths/path-guard.ts`**

The path-containment guard is a pure security primitive consumed by both `cli/commands/` (`refresh`, `sidecar`, `bump`) and `server/routes/sidecar.ts`. It used to live under `cli/util/` and force the BFF to reach across the CLI boundary; the move closes the last cross-driver import from `src/server/` into `src/cli/util/`. Pattern mirrors the earlier `db-path.ts` split.

**A2 — share `collectViewContributions` between user-plugin and built-in harvest**

`core/runtime/plugin-runtime.ts` (user plugins) and `server/index.ts` (built-ins) both used to re-implement the same `viewContributions` projection with subtle drift: the built-in path silently dropped the `priority` field, the user-plugin path preserved it. Extracted to `kernel/extensions/collect-view-contributions.ts` with an optional `excludeQualifiedIds` set so the built-in pass can skip entries already harvested via the user-plugin route. Removes one `eslint-disable complexity` and one duplicated typeof-guard chain.

**A3 — AJV body validation factory for the BFF**

New `server/util/parse-body.ts` exports `makeBodyValidator<T>(schema, messages)`. Each schema compiles ONCE at module import; the hot path is `req.json() → typeof guard → compiled.validate() → throw or return`. Messages route through a `(instancePath, keyword)` mapping table that resolves to existing `SERVER_TEXTS` constants (no message drift); numeric array indices in `instancePath` normalise to `*` so a single mapping entry matches any failing item.

Five hand-rolled `parseBody` / `parsePatchBody` parsers across four routes migrated:

- `server/routes/sidecar.ts` — `POST /api/sidecar/bump`
- `server/routes/preferences.ts` — `PATCH /api/preferences`
- `server/routes/project-preferences.ts` — `PATCH /api/project-preferences`
- `server/routes/plugins.ts` — `PATCH /api/plugins/:id` + bulk `PATCH /api/plugins`

Cuts five `eslint-disable complexity` overrides. Every schema declares `additionalProperties: false`, so unknown keys that previously slipped through silently now surface as `400 bad-query` — typed flags / settings clients gain a stricter contract surface. The propio UI never sends extras, so no end-user observable change.

**A4 — split `assembleBootBundle` into `assemblePluginRuntime` + `assembleKernel`**

The boot pipeline now separates "what plugins exist" (discovery + `kindRegistry`) from "what the kernel exposes to routes" (`kernel` + `contributionsRegistry`). `createServer` chains the two halves in two lines; each half is independently testable.

**Tests**

- `test/server-parse-body.test.ts` — 14 unit tests for the helper (notJson / notObject short-circuits, valid pass-through, mapping resolution per keyword, function resolvers with template interpolation, array index normalisation, schema compiled once).
- `+13 E2E tests` across `preferences-route.test.ts`, `project-preferences-route.test.ts`, `server-sidecar-endpoint.test.ts`, `server-endpoints.test.ts` covering the new `additionalProperties: false` rejection paths, `minLength: 1` constraints on string identifiers, and item-level type checks inside arrays.

1364/1364 tests pass.
