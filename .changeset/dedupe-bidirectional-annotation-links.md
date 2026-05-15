---
"@skill-map/cli": patch
---

Fix double-counted incoming/outgoing link totals when a relation is
declared from BOTH sides of a `.sm` annotation pair (e.g. `supersedes: [B]`
on `A.sm` AND `supersededBy: A` on `B.sm`). The `core/annotations`
extractor walks each node in isolation, so each side independently emits
the same `(A → B, supersedes)` edge; without a global dedup the orchestrator
returns two copies, `recomputeLinkCounts` and the `core/link-counts`
chip then surface inflated `linksInCount` / `linksOutCount` values, and
the watcher's per-rescan `delta.ts#diffLinks` `Set`s occasionally
collapse the duplicate by accident on save, which is what made the bug
appear as "wrong number on cold start, correct after editing anything".

Introduces a `dedupeLinks(links)` pass in `src/kernel/orchestrator/extractors.ts`
that runs in `src/kernel/orchestrator/index.ts` immediately after
`walkAndExtract` and before `recomputeLinkCounts` / `runAnalyzers`. The
identity key is `(source, target, kind, normalizedTrigger ?? '')`,
matching the existing `kernel/scan/delta.ts#linkIdentity` so the diff
path stays consistent. `sources[]` arrays of merged duplicates union
(preserving first-seen order, no repeats) so an edge legitimately
produced by multiple extractors keeps every attribution visible.
Deterministic, first-occurrence wins given walk order. Covered by 10
new unit tests in `src/kernel/orchestrator/__tests__/dedupe-links.test.ts`.

Also: two small cyclomatic-complexity refactors to keep the workspace
lint cap (`max 8`) green. `validate-all/index.ts` extracts an
`isMissingStringField` helper from `collectFrontmatterBaseFindings`
(9 → 6). `kernel/util/trigger-resolve.ts` and the paired
`ui/src/services/trigger-resolve.ts` split `buildNameIndex` into
`indexByCanonicalName` + `fillIndexWithPathBasename` + `canonicalName`
helpers (12 → 1). Semantics unchanged in both refactors; covered by
the existing trigger-resolve suite (UI 19/19 green).

## User-facing

**Bidirectional `.sm` relations no longer double-count.** A
relation declared from both sides (e.g. `supersedes` +
`supersededBy`) now tallies as `1` in the `linksIn` /
`linksOut` chips and the graph. Before, the count was inflated
on cold start and dropped on the next save.
