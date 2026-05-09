---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Drop the four denormalised fields (`title`, `description`, `stability`, `version`) from the public `Node` surface. The DB columns survive as indexing surface; the JSON wire shape and TypeScript `Node` interface no longer carry them.

The kernel used to project those four into `Node.{title,description,stability,version}` from their canonical sources (`frontmatter.{name,description}` and `sidecar.annotations.{stability,version}`) so consumers had a single flat read surface. With the inspector slot redesign incoming and the explicit decision to read directly from the canonical surfaces, the alias became redundant: same data, two paths, one of them unnecessary indirection.

The DB columns (`scan_nodes.{title,description,stability,version}`) stay so SQL-backed verbs (`sm list --sort-by`, faceted listings) keep their indexing fast path. The persistence layer projects the columns at write time from the canonical sources rather than from kernel-set Node fields. That keeps SQL ergonomic without polluting the API.

**Surface changes**

- `spec/schemas/node.schema.json` — `title` / `description` / `stability` / `version` removed from the property list. The schema's curated public shape now matches the runtime `Node` interface.
- `src/kernel/types.ts` — `Node` interface drops the four fields. `Stability` type stays (used by extension manifests).
- `src/kernel/orchestrator.ts` — `buildNode()` no longer populates the dropped fields; `applyAnnotationsOverlay()` removed (its only job was to set `node.{stability,version}` from the sidecar, now done at persistence-projection time).
- `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodeToRow()` projects the four columns from `node.frontmatter` and `node.sidecar?.annotations` via three small helpers (`pickString`, `pickStability`, `pickIntegerVersion`).
- `src/kernel/adapters/sqlite/scan-load.ts` — `rowToNode()` no longer rehydrates the four fields onto Node. Storage adapter consumers that need them read the row directly.
- `src/cli/commands/show.ts` — `collectNodeFields()` projects render-time via a new `projectAnnotationFields(node)` helper. Trio of single-purpose pickers added (`pickNonEmptyString`, `pickStabilityFromAnnotation`, `pickIntegerVersionFromAnnotation`) keep complexity ≤ 8.
- `src/cli/commands/export.ts`, `src/built-in-plugins/formatters/ascii/index.ts` — `pickTitle()` reads `frontmatter.name` directly.
- `src/built-in-plugins/rules/validate-all/index.ts` — `toNodeForSchema()` projection drops the four fields (they're no longer in `node.schema.json`).
- `ui/src/models/api.ts` — `INodeApi` drops the four fields. The unused `TStability` import is gone.
- `ui/src/services/collection-loader.ts` — `projectNode()` no longer falls back to `api.{title,description}`; reads directly from `frontmatter.{name,description}`.

**Tests** — fixtures and assertions across `node-enrichments.test.ts`, `render-sanitize-invariant.test.ts`, `scan-incremental.test.ts`, `server-query-adapter.test.ts`, `sidecar-reader.test.ts`, and the conformance case `sidecar-end-to-end.json` updated. The `node-enrichments` test uses the dropped fields as opaque sentinels to verify enrichment buffer mechanics; those sites cast through `unknown as Partial<Node>` with an explanatory comment — the persistence layer JSON-serialises the bag verbatim, so the round-trip works regardless of the strict Node typing.

**Migration** — consumers that read `node.title` migrate to `node.frontmatter?.name`; same shape for `description` (`frontmatter.description`), `stability` (`sidecar.annotations.stability`), and `version` (`sidecar.annotations.version`). DB queries that filter or sort by these columns work unchanged.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
