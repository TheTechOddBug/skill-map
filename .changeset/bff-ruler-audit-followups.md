---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

BFF compliance audit follow-ups (`bff-ruler` on `src/server/`).

**Error envelope unification.** Three call sites that hand-rolled their own 4xx/5xx JSON shape now throw `HTTPException` (or a typed subclass) and drain through the single global `app.onError` formatter so every BFF error response carries the canonical `{ ok: false, error: { code, message, details } }` envelope:

- `routes/scan.ts` (`db-missing` on `POST /api/scan`): now `throw new DbMissingError(...)`; `details: null`.
- `routes/plugins.ts` (`db-missing` on bulk + project list): same `DbMissingError` path.
- `routes/contributions.ts` (`missing-path` 400, `unknown-contribution` 404): `HTTPException` throws with externalized messages.
- `loopback-gate.ts` (`host-not-allowed` / `origin-not-allowed` 403): now `throw new LoopbackGateError({ code, message })`. `formatError` shapes it to the canonical envelope with `details: null`. The pre-baked terse message keeps the gate opaque to probes.
- `routes/plugins.ts` bulk PATCH: `details: { id: <offender> }` now lives on `BulkValidationError` and is stamped centrally in `formatError` instead of inlined at each call site.

`TErrorCode` gains `'host-not-allowed'` and `'origin-not-allowed'`. `cli-contract.md` §Server documents the new envelope shape and adds matching rows to the HTTP status mapping + error-code source list.

**Input validation tightened.** `GET /api/contributions/:pluginId/:extensionId/:contributionId` now validates the three URL segments against the qualified-id alphabet `/^[A-Za-z0-9._-]+$/` and the `?path=` query string via a new `parseRequiredString` helper in `util/parse-query.ts`. `GET /api/graph` rejects `?format=` values longer than 32 chars or outside `/^[a-z0-9-]+$/` before the formatter registry lookup.

**Internal type renames** (workspace-internal, not part of the public API surface):

- `IKindRegistry` → `TKindRegistry`, `IContributionsRegistry` → `TContributionsRegistry` (they are `Record<>` aliases, not interfaces).
- `IContributionsRegistryEntry` declared twice with drift on `priority?`. One canonical declaration in `envelope.ts` with the field; `contributions-registry.ts` re-exports it.
- `ServerHandle` → `IServerHandle` (consistency with the rest of the `I*` interface convention).

**Misc.** `src/tsconfig.json` now lists `server/**/*` and `core/**/*` in `include` explicitly (they were previously type-checked only via transitive resolution from `cli/`). The seven em dashes in user-facing strings in `i18n/server.texts.ts` were replaced with commas / parentheses. The two `scan-guard-trip` literals in `routes/scan.ts` are now externalized to `SERVER_TEXTS`.
