---
"@skill-map/cli": patch
---

Architect-audit follow-up: full complexity-disable sweep across `src/kernel/adapters/sqlite/`. **18 `eslint-disable complexity` → 0** across 7 files. Pure structural refactor — every function preserves its prior signature and behaviour; tests pass unchanged.

**`storage-adapter.ts` (2 → 0).** `applyPersistDefaults` helper replaces the inline `?? []` / `?? new Set()` cascades in `persistScansThroughNonTx` and `buildTxSubset.persist`. Uses object-spread defaults so each call constructs fresh `[]` / `new Set()` instances (no shared mutable state leaks across persist calls).

**`scan-persistence.ts` (3 → 0).**
- `persistScanResult`: extracted `validateScannedAt`, `applyRenames`, `appendStrandedOrphans` (and its `collectKnownOrphanPaths` helper). The transaction body now reads as 5 sequential phase calls.
- `nodeToRow`: split into `projectAnnotationColumns`, `projectSidecarPresence`, `projectSidecarJson`, `projectTokenCounts`. Each helper returns a `Pick<Insertable<…>>` so the main mapping stays type-safe.
- `linkToRow`: split into `projectLinkTrigger`, `projectLinkLocation`.

**`contributions.ts` (1 → 0).** `replaceAllScanContributions` split into 4 sweep passes (`sweepOrphanContributions`, `sweepCatalogContributions`, `sweepPerTupleContributions`, `upsertContributionsBuffer`) plus internal helpers `buildContributionsBufferKeys`, `groupFreshlyRunTuplesByPluginExt`, `deleteStaleTupleRows`. Same per-tuple sweep ordering; NUL-separator invariant preserved.

**`migrations.ts` (1 → 0).** `applyMigrations` extracted `resolveMigrationTarget`, `writePreMigrateBackup`, `applyOneMigration`. The remaining body is dispatch glue.

**`plugin-migrations.ts` (1 → 0).** `applyPluginMigrations` extracted `preflightValidateAll` (Layer 1) and `applyOnePluginMigration` (Layer 2 + per-migration transaction). The two-pass safe-apply contract stays intact.

**`plugin-migrations-validator.ts` (4 → 0).**
- `validatePluginMigrationSql` split into `detectForbiddenKeywords` + `detectStatementViolations` (with `matchStatement` and `collectObjectViolations` helpers).
- `objectName` split into `stripParenAndTrailingPunct`, `splitSchemaQualifier`, `stripIdentifierWrapper`.
- State machines `detectCommentMarkerInLiteral` and `splitStatements` refactored to use `scanCheckedLiteral` / `findCommentMarker` / `copyQuotedRegion` / `skipUntilCloser` helpers. The char-by-char dispatcher in each main function shrinks to a 4-way `QUOTE_OPENERS` check.

**`history.ts` (5 → 0).**
- `executionToRow` split into `projectExecutionOptionalAudit` + `projectExecutionTokens`.
- `listExecutions` extracted `applyExecutionFilters` (generic over Kysely's `SelectQueryBuilder`).
- `accumulateExecutionRow` split into 4 accumulators: `accumulateTotals`, `accumulatePerAction`, `accumulatePerPeriod`, `accumulatePerNode`.
- `findStrandedStateOrphans` split into 6 per-table sweeps: `collectStrandedJobs/Executions/Summaries/Enrichments/PluginKvs/Favorites`.
- `migrateNodeFks` split into 6 per-table migrators: `migrateJobs/Executions/Summaries/Enrichments/PluginKvs/NodeFavorites` plus `emptyMigrateReport`. Each preserves the collision-detect → delete → insert-if-no-collision pattern verbatim.

Net: +971/-667 LOC (overhead is per-helper jsdoc; each extracted function stays ~10-50 LOC and navigable). 1381/1381 tests pass.
