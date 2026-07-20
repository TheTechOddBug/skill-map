/**
 * Sidecar reader public surface (Step 9.6.2).
 *
 * Bundles parse, drift detection, and orphan discovery for the
 * orchestrator and built-in rules. Consumers should import from this
 * module rather than the individual files so future internal layout
 * changes stay decoupled from the rest of the kernel.
 */

export { readSidecarFor, sidecarPathFor, _resetSidecarValidatorCacheForTests } from './parse.js';
export type {
  IParsedSidecar,
  ISidecarParseIssue,
  ISidecarReadResult,
} from './parse.js';
export { computeDriftStatus } from './drift.js';
export { discoverOrphanSidecars } from './discover-orphans.js';
export type { IOrphanSidecar } from './discover-orphans.js';
export {
  buildSuppressionEntry,
  existingSuppressions,
  mergeSuppression,
  normalizeSuppressionType,
} from './suppression-edit.js';
export {
  FilesystemSidecarStore,
  deepMerge,
  _resetSidecarStoreValidatorCacheForTests,
} from './store.js';
export type { ISidecarStore } from './store.js';
