/**
 * Kernel entry point. `createKernel()` returns a shell with an empty registry
 * and no bound ports. Driving adapters (CLI, Server) are expected to
 * wire adapters before invoking use cases.
 */

import { Registry } from './registry.js';
import type { IAnnotationContribution } from './extensions/base.js';
import type { IRegisteredAnnotationKey } from './types/annotation-catalog.js';
import type { IRegisteredViewContribution } from './types/view-catalog.js';

export type { IRegisteredAnnotationKey } from './types/annotation-catalog.js';
export type {
  IRegisteredViewContribution,
  IViewContribution,
  SlotPayload,
  SlotPayloadMap,
  TSettingDeclaration,
  TSlotName,
  TInputTypeName,
  TSeverity,
  TSettingValue,
} from './types/view-catalog.js';

export interface Kernel {
  registry: Registry;
  /**
   * Step 9.6.6, read-only catalog of plugin-contributed annotation
   * keys, keyed by `(pluginId, key)`. Populated at plugin-load time;
   * pure read with no side effects. Built-in catalog (from
   * `annotations.schema.json`) is NOT included here.
   */
  getRegisteredAnnotationKeys: () => readonly IRegisteredAnnotationKey[];
  /**
   * Internal, replace the frozen catalog. Called once by the
   * plugin runtime composer after every plugin has loaded; consumers
   * MUST treat the resulting array as immutable.
   */
  setRegisteredAnnotationKeys: (entries: readonly IRegisteredAnnotationKey[]) => void;
  /**
   * Step 11.x, read-only catalog of plugin-contributed view
   * contributions, keyed by `(pluginId, extensionId, contributionId)`.
   * Populated at plugin-load time; pure read with no side effects.
   * Mirror of `getRegisteredAnnotationKeys` for the view contribution
   * surface (see `architecture.md` §View contribution system →
   * Runtime catalog).
   */
  getRegisteredViewContributions: () => readonly IRegisteredViewContribution[];
  /**
   * Internal, replace the frozen view-contribution catalog. Called
   * once by the plugin runtime composer after every plugin has loaded;
   * consumers MUST treat the resulting array as immutable.
   */
  setRegisteredViewContributions: (entries: readonly IRegisteredViewContribution[]) => void;
}

export function createKernel(): Kernel {
  let annotationKeys: readonly IRegisteredAnnotationKey[] = Object.freeze([]);
  let viewContributions: readonly IRegisteredViewContribution[] = Object.freeze([]);
  return {
    registry: new Registry(),
    getRegisteredAnnotationKeys() { return annotationKeys; },
    setRegisteredAnnotationKeys(entries) {
      annotationKeys = Object.freeze([...entries]);
    },
    getRegisteredViewContributions() { return viewContributions; },
    setRegisteredViewContributions(entries) {
      viewContributions = Object.freeze([...entries]);
    },
  };
}

export type { IAnnotationContribution } from './extensions/base.js';

// Pre-1.0 export surface, every name is enumerated explicitly so a
// rename / addition in any of the underlying modules requires an
// explicit edit here. The previous `export type *` wildcards from
// `./types.js` and `./ports/index.js` re-published every internal type
// implicitly; pre-1.0 that's quiet drift, post-1.0 it would silently
// turn refactors into major bumps. Group order: registry, domain
// types, orchestrator, watcher / delta / query, ports, extension
// kinds.

export { Registry, EXTENSION_KINDS, DuplicateExtensionError, qualifiedExtensionId } from './registry.js';
export type { IExtension, ExtensionKind } from './registry.js';

// --- domain types (./types.ts) -----------------------------------------
export type {
  // unions
  NodeKind,
  LinkKind,
  Confidence,
  Severity,
  Stability,
  TExecutionMode,
  ExecutionKind,
  ExecutionStatus,
  ExecutionFailureReason,
  ExecutionRunner,
  // value objects
  TripleSplit,
  LinkTrigger,
  LinkLocation,
  LinkOccurrence,
  IExternalRef,
  // graph
  Node,
  Link,
  IssueFix,
  Issue,
  ScanStats,
  ScanScannedBy,
  ScanResult,
  // history surface
  ExecutionRecord,
  HistoryStatsTotals,
  HistoryStatsTokensPerExtension,
  HistoryStatsExecutionsPerPeriod,
  HistoryStatsTopNode,
  HistoryStatsPerExtensionRate,
  HistoryStatsErrorRates,
  HistoryStats,
} from './types.js';

// --- orchestrator (./orchestrator.ts) ---------------------------------
export {
  runScan,
  runScanWithRenames,
  detectRenamesAndOrphans,
  mergeNodeWithEnrichments,
  runExtractorsForNode,
} from './orchestrator.js';
export type {
  RunScanOptions,
  RenameOp,
  IExtractorRunRecord,
  IEnrichmentRecord,
  IPersistedEnrichment,
} from './orchestrator.js';

// --- adapters (./adapters/...) -----------------------------------------
export { InMemoryProgressEmitter } from './adapters/in-memory-progress.js';
export {
  KV_SCHEMA_KEY,
  makeDedicatedStoreWrapper,
  makeKvStoreWrapper,
  makePluginStore,
} from './adapters/plugin-store.js';
export type {
  IDedicatedStorePersist,
  IDedicatedStoreWrapper,
  IKvStorePersist,
  IKvStoreWrapper,
  TPluginStore,
} from './adapters/plugin-store.js';

// --- scan utilities (./scan/...) ---------------------------------------
export { createChokidarWatcher, createParcelWatcher } from './scan/watcher.js';
export type {
  IFsWatcher,
  IWatchBatch,
  IWatchEvent,
  ICreateFsWatcherOptions,
  TWatchEventKind,
} from './scan/watcher.js';
export { computeScanDelta, isEmptyDelta } from './scan/delta.js';
export type { IScanDelta, INodeChange, TNodeChangeReason } from './scan/delta.js';
export { parseExportQuery, applyExportQuery, ExportQueryError } from './scan/query.js';
export type { IExportQuery, IExportSubset } from './scan/query.js';

// --- ports (./ports/...) -----------------------------------------------
export type { ITransactionalStorage, StoragePort } from './ports/storage.js';
export type {
  IIssueRow,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistOptions,
} from './types/storage.js';
export type { FilesystemPort, IWalkOptions, NodeStat } from './ports/filesystem.js';
export type {
  PluginLoaderPort,
  IDiscoveredPlugin,
  ILoadedExtension,
  IPluginManifest,
  IPluginStorageSchema,
  TPluginLoadStatus,
  TPluginStorage,
} from './ports/plugin-loader.js';
export type {
  ProgressEmitterPort,
  ProgressEvent,
  TProgressListener,
} from './ports/progress-emitter.js';
export type {
  LoggerPort,
  TLogLevel,
  TLogMethodLevel,
  LogRecord,
} from './ports/logger.js';
export {
  LOG_LEVELS,
  isLogLevel,
  logLevelRank,
  parseLogLevel,
} from './ports/logger.js';
export { SilentLogger } from './adapters/silent-logger.js';
export { log, configureLogger, resetLogger, getActiveLogger } from './util/logger.js';

// --- extension kinds (./extensions/...) --------------------------------
export type {
  IProvider,
  IRawNode,
  IExtractor,
  IExtractorContext,
  IExtractorCallbacks,
  IAnalyzer,
  IAnalyzerContext,
  IAction,
  IActionPrecondition,
  IActionContext,
  IActionResult,
  TActionWrite,
  IFormatter,
  IFormatterContext,
  IHook,
  IHookContext,
  THookTrigger,
  THookFilter,
  IExtensionBase,
} from './extensions/index.js';
export { HOOK_TRIGGERS } from './extensions/index.js';
export {
  makeHookDispatcher,
  makeEvent,
  type IHookDispatcher,
} from './extensions/hook-dispatcher.js';
