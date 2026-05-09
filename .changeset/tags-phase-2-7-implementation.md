---
"@skill-map/cli": minor
---

Tags · Phases 2-7 (full implementation): persistence, BFF wire shape, CLI, UI.

Phase 1 declared the dual-source tag system at the spec level (`frontmatter.tags` for author tags, `sidecar.annotations.tags` for user tags, both first-class). This bump lands the implementation end-to-end.

**Phase 2 — DB schema + adapter**

- `src/migrations/001_initial.sql` — new `scan_node_tags(node_path, tag, source)` table with `(node_path, tag, source)` PK, `CHECK source IN ('author','user')`, `(tag)` index for indexed search, `(node_path)` index for per-node projection.
- `src/kernel/adapters/sqlite/schema.ts` — `IScanNodeTagsTable` interface added; registered on `IDatabase`.
- `src/kernel/adapters/sqlite/tags.ts` — new adapter with `replaceAllScanTags(trx, records, livePaths)` (orphan-sweep + replace-all per-node), `loadTagsForNode(db, path)`, `loadTagsForPaths(db, paths)`, and `findNodesByTag(db, tag, source?)` for the CLI.

**Phase 3 — Persistence projection**

- `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodesToTagRecords(nodes)` projects rows from BOTH `frontmatter.tags` (`source='author'`) and `sidecar.annotations.tags` (`source='user'`); per-source intra-array dedup; called inside the same persist transaction as `scan_nodes` / `scan_links` / `scan_contributions`. Cached nodes' tag rows project from the cached `node` (already in memory) so the rebuild is cheap regardless of cache hit / miss.

**Phase 4 — BFF wire shape**

- `ui/src/models/api.ts` — `INodeApi.tags?: { byAuthor: readonly string[]; byUser: readonly string[] }` + `ITagsApi` interface.
- `src/kernel/ports/storage.ts` — `StoragePort.tags` namespace (`listForNode`, `listForPaths`, `findNodes`).
- `src/kernel/adapters/sqlite/storage-adapter.ts` — wires the tags namespace from the `tags.ts` adapter helpers.
- `src/server/routes/nodes.ts` — `/api/nodes/:pathB64` and `/api/nodes` (bulk) decorate every node with its `tags = { byAuthor, byUser }`. Bulk path keeps the round-trip count at one (one query for contributions + one for tags) regardless of page size.
- `src/server/routes/scan.ts` — `/api/scan` (the SPA's F5 / cold-boot canonical corpus) decorates the same way; tags + contributions loaded via `Promise.all` to keep the latency profile flat.

**Phase 5 — CLI**

- `src/cli/commands/list.ts` — new `--tag <name>` flag (matches author OR user tag, indexed `WHERE tag = ?` query) + `--tag-source author|user` (narrows to one surface). `--tag-source` without `--tag` is rejected with a directed error. `--tag <name>` with zero matches prints "No nodes found." (or `[]\n` under `--json`) and exits 0. The body of `run()` was split into `#parseFlags` / `#runQuery` / `#resolveTagAllowList` / `#buildFindNodesFilter` to keep cyclomatic complexity under the project limit.
- `src/cli/i18n/list.texts.ts` — new error texts.
- `context/cli-reference.md` regenerated.

**Phase 6 — UI**

- `ui/src/app/components/annotations-panel/*` — `<sm-annotations-panel>` accepts a new `authorTags: readonly string[]` input. The Taxonomy section renders both sources in a single panel: author chips first with an outlined style, user chips after with the default filled style. Each chip carries `data-tag-source="author|user"` for tests + selectors. Tooltips clarify attribution per chip. CSS adds `.ann-panel__chip--author` / `.ann-panel__chip--user` rules.
- `ui/src/app/views/inspector-view/inspector-view.ts` — new `authorTags()` computed projects from `node.frontmatter.tags`; passed into the panel via the new input.
- `ui/src/i18n/annotations-panel.texts.ts` — `tagSourceAuthorTooltip` and `tagSourceUserTooltip` strings added.

**Phase 7 — Tests + smoke**

- `src/test/scan-readers.test.ts` — `IListOverrides` + `buildList()` extended with `tag` / `tagSource` so the suite's `ListCommand` instantiations don't leak Clipanion `Option` descriptors when `--tag*` is unused.
- `ui/src/app/components/annotations-panel/annotations-panel.spec.ts` — coverage for: user-only tag rendering, both sources rendered with author-first ordering, taxonomy section hidden when both sources empty.
- Smoke-tested end-to-end from a 3-node fixture: `--tag` matches the union; `--tag-source user` narrows correctly; missing tag returns "No nodes found." (exit 0); sidecar-driven user tags appear after a re-scan.

Test suite (1175 tests) green; lint, spec drift, reference drift checks clean.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
