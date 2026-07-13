/**
 * Runtime contracts for the six extension kinds: `IProvider`, `IExtractor`,
 * `IAnalyzer`, `IAction`, `IFormatter`, `IHook`. Each module below declares
 * (a) the manifest shape, structurally mirrors the corresponding schema in
 * `@skill-map/spec/schemas/extensions/`, and (b) the runtime method(s) the
 * kernel calls on an instance of the extension.
 *
 * `IAction` carries two optional runtime surfaces: a scan-time
 * `project(ctx)` self-projection (deterministic, emits the Action's own
 * view contributions during the contribution phase) and the on-demand
 * `invoke(input, ctx)` executor (deterministic in-process call;
 * probabilistic runner dispatch lands with the job subsystem). See
 * `kernel/extensions/action.ts` for the detailed contract.
 *
 * A plugin's default export IS the runtime instance: an extractor exports
 * `{ ...manifest, extract: (ctx) => void }`, not a class. This keeps ESM
 * interop simple (no new / constructor dance) and matches how Claude Code's
 * own subagents/skills are declared.
 *
 * **Naming note.** `IProvider` is the extension-surface kind that plugin
 * authors implement. The `adapter` term is reserved for the hexagonal
 * architecture's driven adapters (`StoragePort.adapter`, see
 * `kernel/adapters/`); the two concepts are deliberately namespaced
 * apart even though they used to share the word historically.
 */

export type {
  IActivityInstallBase,
  IActivityInstallEvent,
  IActivityInstallJsonHooks,
  IActivityInstallPluginFile,
  IActivitySignal,
  IActivitySpawnExecution,
  IActivitySpawnRelation,
  IProvider,
  IProviderActivityAdapter,
  IProviderDetect,
  IProviderKind,
  IProviderKindUi,
  IProviderReadConfig,
  IProviderUi,
  IProviderWalkOptions,
  IRawNode,
  TActivityInstall,
  TActivityPhase,
  TIdentifierSource,
  TProviderKindIcon,
} from './provider.js';
export { resolveProviderWalk, collectReadExtensions } from './provider.js';
export type { IExtractor, IExtractorContext, IExtractorCallbacks, IEmittedNode } from './extractor.js';
export type {
  IAnalyzer,
  IAnalyzerContext,
  IAnalyzerOrphanSidecar,
  INameClaim,
  INameMismatch,
} from './analyzer.js';
export type {
  IAction,
  IActionPrecondition,
  IActionContext,
  IActionProjectionContext,
  IActionResult,
  TActionIoKind,
  TActionWrite,
  TActionWriteKind,
} from './action.js';
export type { IFormatter, IFormatterContext } from './formatter.js';
export type { IHook, IHookContext, THookTrigger, THookFilter } from './hook.js';
export { HOOK_TRIGGERS } from './hook.js';
export type { IExtensionBase, IAnnotationContribution, IBuiltInManifest, TExtensionStability } from './base.js';
export {
  collectViewContributions,
  type ICollectViewContributionsOptions,
} from './collect-view-contributions.js';
export type { TExecutionMode } from '../types.js';
