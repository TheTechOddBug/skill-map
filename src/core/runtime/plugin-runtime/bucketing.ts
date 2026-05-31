/**
 * Bucket loaded user-plugin extensions into the per-kind arrays a
 * `IPluginRuntime` exposes, plus the per-extension annotation /
 * view contribution catalogs that `loadPluginRuntime` aggregates.
 *
 * Shares the dispatch table with `plugins/built-ins.ts:
 * bucketBuiltIn` via `bucketByKind` so the loader and the built-ins
 * walk the same per-kind contract.
 */

import {
  collectViewContributions,
  type IAnnotationContribution,
} from '../../../kernel/extensions/index.js';
import type { IRegisteredAnnotationKey } from '../../../kernel/types/annotation-catalog.js';
import type { ILoadedExtension } from '../../../kernel/types/plugin.js';
import { bucketByKind } from '../../../kernel/util/bucket-by-kind.js';

import type { IPluginRuntime } from './index.js';

/**
 * Drop a plugin's loaded extensions into the per-kind buckets. Each
 * `ext.instance` arrives from the loader already cloned with
 * `pluginId` injected (spec § A.6), so this function never mutates.
 *
 * Shares the dispatch table with `plugins/built-ins.ts:
 * bucketBuiltIn` via `bucketByKind`. Actions are intentionally NOT
 * passed a destination array, they dispatch via the job subsystem
 * (Step 10), not the scan pipeline. The manifest row still records
 * regardless of kind so `sm plugins list` / `sm actions list` see
 * every extension that loaded.
 */
export function bucketLoaded(loaded: ILoadedExtension[], runtime: IPluginRuntime): void {
  for (const ext of loaded) {
    const instance = ext.instance;
    if (!isExtensionInstance(instance)) continue;
    bucketByKind(ext.kind, instance, {
      provider: runtime.extensions.providers,
      extractor: runtime.extensions.extractors,
      analyzer: runtime.extensions.analyzers,
      formatter: runtime.extensions.formatters,
      hook: runtime.extensions.hooks,
      // `action` intentionally absent, see docstring.
    });
    runtime.manifests.push({
      id: ext.id,
      pluginId: ext.pluginId,
      kind: ext.kind,
      version: ext.version,
      description: (instance as { description?: unknown }).description as string ?? '',
      ...(ext.entryPath ? { entry: ext.entryPath } : {}),
    });
    // Step 9.6.6, fold this extension's annotation contributions
    // into the runtime-level catalog. Per-extension shape was already
    // validated at the loader (root requires exclusive; schema must
    // AJV-compile); cross-plugin collision detection happens after
    // every plugin has loaded.
    collectAnnotationContributions(ext.pluginId, instance, runtime.annotationContributions);
    // Step 11.x, same for view contributions. Per-extension shape was
    // already validated at the loader (`contract` against the closed
    // catalog); no cross-plugin collision detection needed because the
    // qualified id `<pluginId>/<extensionId>/<contributionId>` is
    // structurally unique.
    collectViewContributions(ext.pluginId, ext.id, instance, runtime.viewContributions);
  }
}

/**
 * Pluck the optional `annotation` (singular) declaration off a loaded
 * extension instance and append one row to the runtime-level catalog.
 * Defaults are filled in (`location: 'namespaced'`, `ownership: 'shared'`)
 * so consumers downstream see a fully-resolved shape. The annotation key
 * IS the extension id (structure-as-truth, replaces the `annotationContributions`
 * map). Built-in catalog fields (from `annotations.schema.json`) are NOT
 * collected here, they are not plugin-contributed.
 */
export function collectAnnotationContributions(
  pluginId: string,
  instance: unknown,
  out: IRegisteredAnnotationKey[],
): void {
  const row = tryReadAnnotationRow(pluginId, instance);
  if (row !== null) out.push(row);
}

// Linear annotation-row guard chain (each `return null` is one branch).
// Cyclomatic count grows with each guard but the logic stays flat.
// eslint-disable-next-line complexity
function tryReadAnnotationRow(
  pluginId: string,
  instance: unknown,
): IRegisteredAnnotationKey | null {
  if (typeof instance !== 'object' || instance === null) return null;
  const inst = instance as Record<string, unknown>;
  const raw = inst['annotation'];
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Partial<IAnnotationContribution>;
  if (typeof entry.schema !== 'object' || entry.schema === null) return null;
  const extId = inst['id'];
  if (typeof extId !== 'string' || extId.length === 0) return null;
  return {
    pluginId,
    key: extId,
    location: entry.location ?? 'namespaced',
    ownership: entry.ownership ?? 'shared',
    schema: entry.schema as Record<string, unknown>,
  };
}

export function isExtensionInstance(v: unknown): v is { id: string; kind: string; version: string; description?: unknown } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['id'] === 'string' &&
    typeof (v as Record<string, unknown>)['kind'] === 'string' &&
    typeof (v as Record<string, unknown>)['version'] === 'string'
  );
}
