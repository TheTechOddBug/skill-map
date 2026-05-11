---
"@skill-map/cli": minor
---

Promote sidecar-awareness into the kernel's per-(node, extractor) cache key so `.sm` edits propagate to the UI on every code path (watch, scan, CLI, BFF cold start) without busting unrelated cached extractors.

**The bug**

`scan_extractor_runs` was keyed only by `(node_path, extractor_id, body_hash_at_run)`. Extractors that read `ctx.node.sidecar.*` (`core/stability`, `core/annotations`) would silently reuse their prior contribution after a sidecar-only edit because neither `bodyHash` nor `frontmatterHash` changed when the user edited `<basename>.sm`. The previous PR (`13f84847`) patched the symptom inside `src/core/watcher/runtime.ts` by detecting `.sm` paths in a watcher batch and disabling the kernel cache wholesale for that pass — broad, brittle, and unreachable from other entry points (`sm scan`, `sm refresh`, the BFF's `POST /api/scan`).

**The fix**

- `scan_extractor_runs` gains a `sidecar_annotations_hash_at_run TEXT NOT NULL` column. Folded directly into `001_initial.sql` per the greenfield policy (no released consumer depends on the prior shape).
- The orchestrator resolves the sidecar overlay BEFORE the cache decision, hashes the canonical-form (`yaml.dump({ sortKeys: true, lineWidth: -1, noRefs: true, noCompatMode: true })`) annotations block, and threads the value through `computeCacheDecision` + `IExtractorRunRecord` + persistence. Absent / empty annotations canonicalise to `{}` so the hash stays stable across "no sidecar" → "empty annotations".
- `computeCacheDecision` now requires both `bodyHash` AND `sidecarAnnotationsHash` to match for a cache hit — universal invalidation on `.sm` changes. An opt-in `readsSidecar` flag was considered and rejected because forgetting it produces a silent stale-data bug; the cost of re-running an extractor on a sidecar edit is negligible (pure CPU, sidecars change rarely), and the gain is zero cognitive load for plugin authors.
- The watcher workaround is reverted: `runtime.ts` no longer inspects batch paths for `.sm` suffixes and never disables the cache. The kernel does the right thing on every path now.

**Files**

- `src/migrations/001_initial.sql` — `scan_extractor_runs` gains `sidecar_annotations_hash_at_run TEXT NOT NULL` (folded inline; no separate migration file).
- `src/kernel/adapters/sqlite/schema.ts` — adds `sidecarAnnotationsHashAtRun: string` to `IScanExtractorRunsTable`.
- `src/kernel/adapters/sqlite/scan-load.ts` — exports `IPriorExtractorRun` (`{ bodyHash, sidecarAnnotationsHash }`); reshapes the load map's inner value.
- `src/kernel/adapters/sqlite/scan-persistence.ts` — `extractorRunToRow` writes the new column.
- `src/kernel/orchestrator.ts` — new `resolveSidecarOverlay` (split from the previous `resolveAndApplySidecar` so the overlay is computed BEFORE the cache decision); new `canonicalSidecarAnnotations` helper; `computeCacheDecision` consults the sidecar hash for every applicable extractor; `IExtractorRunRecord` carries `sidecarAnnotationsHashAtRun`; the walk loop attaches the resolved overlay onto each node via `attachSidecar` (used by both the full-cache-hit and the partial / fresh paths).
- `src/kernel/ports/storage.ts` — `loadExtractorRuns` return type updated to `Map<string, Map<string, IPriorExtractorRun>>`.
- `src/core/runtime/scan-runner.ts` — type plumbing for the new prior-runs Map shape.
- `src/core/watcher/runtime.ts` — drops the `invalidateCache` parameter on `runOnePass` / `handleBatch` and the `.sm`-suffix probe on the primary watcher's batch.
- `src/test/sidecar-aware-cache.test.ts` — new file. Two integration tests: (A) a sidecar edit invalidates the per-extractor cache so registered probes re-run on the next pass; (B) end-to-end with the real `core/stability` extractor — flipping `annotations.stability` from `experimental` to `deprecated` produces the new contribution (the watcher-bug scenario, now fixed kernel-side).
- `src/test/scan-extractor-runs.test.ts` — round-trip test updated to assert both `bodyHash` AND `sidecarAnnotationsHash` survive the load.
- `spec/db-schema.md` — documents the new column under `scan_extractor_runs`.

**Greenfield analyzer**

Pre-1.0 greenfield: the new column is folded directly into `001_initial.sql` rather than shipping as a separate migration file (no released consumer depends on the prior schema). The wire shapes (`Node`, `ScanResult`, plugin manifest) are unchanged. No `spec/versioning.md` bump.

## User-facing

Sidecar edits now propagate to the UI reliably — flipping `stability: experimental` to `deprecated` in a `.sm` updates the card chip on every code path (`sm scan`, `sm watch`, the live UI), not only the watcher heuristic that shipped in `0.21.0`.
