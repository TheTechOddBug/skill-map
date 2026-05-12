/**
 * Barrel, preserves the legacy `./orchestrator.js` import path.
 *
 * The orchestrator was split into a directory of cohesive modules:
 *
 *   - `./orchestrator/index.ts`     , `runScan` / `runScanWithRenames`
 *                                       entry point + scan setup.
 *   - `./orchestrator/walk.ts`      , provider walk + per-node cache
 *                                       dispatch.
 *   - `./orchestrator/cache.ts`     , per-(node, extractor) cache
 *                                       decision + prior snapshot index.
 *   - `./orchestrator/extractors.ts`, per-node extractor invocation +
 *                                       post-walk link-count recompute.
 *   - `./orchestrator/analyzers.ts` , analyzer pass over the merged
 *                                       graph.
 *   - `./orchestrator/renames.ts`   , rename / orphan classification.
 *   - `./orchestrator/frontmatter.ts`, per-kind AJV validation +
 *                                       malformed-fence detection.
 *   - `./orchestrator/node-build.ts`, fresh-node construction, hashing,
 *                                       canonicalisation, sidecar
 *                                       overlay, enrichment merge.
 *
 * Importers continue to depend on `'./orchestrator.js'`; the barrel
 * re-exports every public symbol unchanged.
 */

export {
  runScan,
  runScanWithRenames,
  type IScanExtensions,
  type RunScanOptions,
} from './orchestrator/index.js';

export {
  runExtractorsForNode,
  type IEnrichmentRecord,
  type IExtractorRunRecord,
} from './orchestrator/extractors.js';

export {
  detectRenamesAndOrphans,
  type RenameOp,
} from './orchestrator/renames.js';

export {
  mergeNodeWithEnrichments,
  type IPersistedEnrichment,
} from './orchestrator/node-build.js';
