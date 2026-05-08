---
"@skill-map/cli": minor
---

Drop the transitional legacy `metadata:` frontmatter fallback from `core/annotations`. The extractor now reads structured references (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) **only** from the sidecar `.sm` `annotations:` block (Decision #125 / Step 9.6 canonical surface). The `core/superseded` rule follows the same path and now reads from the sidecar.

**Why.** The fallback was carried as a transition aid while early projects migrated their structured refs from frontmatter to sidecars. The migration is complete in our reference projects, the canonical surface is the sidecar, and keeping the fallback split the source of truth across two surfaces with no real consumer left behind. Removing it shrinks `core/annotations` to a single-source extractor and aligns the docstring with the runtime behaviour.

**Surface changes**

- `src/built-in-plugins/extractors/annotations/index.ts` — `pickMetadata` helper removed; `extract()` no longer reads `ctx.frontmatter.metadata`. Docstring rewritten so the sidecar is the only source. The `seen` dedup set keeps catching repeats across the structured arrays (`requires` / `related` / `conflictsWith` listing the same target) but no longer needs cross-source dedup.
- `src/built-in-plugins/rules/superseded/index.ts` — reads `node.sidecar.annotations.supersededBy` instead of `node.frontmatter.metadata.supersededBy`. Skips nodes without a present sidecar. Manifest description and module docstring updated.
- `src/built-in-plugins/rules/broken-ref/index.ts` — docstring fixed (the rule already read `frontmatter.name`; the comment incorrectly referred to `metadata.name`).

**Tests**

- `src/built-in-plugins/extractors/extractors.test.ts` — `annotations extractor` describe block rewritten: every test now seeds the sidecar overlay (`withAnnotations(...)`); legacy `metadata:` fixtures replaced by sidecar inputs. Adds an explicit guard test "ignores legacy frontmatter `metadata:` (sidecar is the only source)".
- `src/built-in-plugins/rules/rules.test.ts` — `mockNode` helper packs `extraMeta` into `node.sidecar.annotations` instead of `node.frontmatter.metadata`. The `ignores nodes with no metadata block` test renamed to `ignores nodes with no sidecar annotations`.
- `src/test/scan-e2e.test.ts`, `src/test/scan-incremental.test.ts`, `src/test/scan-persistence.test.ts`, `src/test/scan-readers.test.ts`, `src/test/broken-ref-trigger-resolution.test.ts` — fixtures migrated from inline `metadata:` blocks to co-located `.sm` sidecars. Each test that exercised structured-link emission now does a baseline scan to capture real `body` / `frontmatter` hashes, then writes the sidecar with those hashes (the sidecar reader marks status `fresh` only when both hashes match the live file). The `before(() => ...)` setup hooks become `before(async () => ...)` where needed.

**Persistence.** No SQL migration. The scan caches (`scan_extractor_runs`, `node_enrichments`) self-revalidate on the next scan; rows attributed to the prior `metadata:`-fed annotations stay in the cache as orphans until invalidated.

**Pre-1.0 minor bump.** Per `spec/versioning.md` § Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`. Any project that still has `metadata: { supersedes / requires / related / supersededBy / conflictsWith }` in markdown frontmatter loses those edges silently on the next scan; migrate them into a co-located `.sm` `annotations:` block.
