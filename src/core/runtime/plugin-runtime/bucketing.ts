/**
 * Bucket loaded user-plugin extensions into the per-kind arrays a
 * `IPluginRuntimeBundle` exposes, plus the per-extension annotation /
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

import type { IPluginRuntimeBundle } from './index.js';

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
export function bucketLoaded(loaded: ILoadedExtension[], bundle: IPluginRuntimeBundle): void {
  for (const ext of loaded) {
    const instance = ext.instance;
    if (!isExtensionInstance(instance)) continue;
    bucketByKind(ext.kind, instance, {
      provider: bundle.extensions.providers,
      extractor: bundle.extensions.extractors,
      analyzer: bundle.extensions.analyzers,
      formatter: bundle.extensions.formatters,
      hook: bundle.extensions.hooks,
      // `action` intentionally absent, see docstring.
    });
    bundle.manifests.push({
      id: ext.id,
      pluginId: ext.pluginId,
      kind: ext.kind,
      version: ext.version,
      ...(ext.entryPath ? { entry: ext.entryPath } : {}),
    });
    // Step 9.6.6, fold this extension's annotation contributions
    // into the bundle-level catalog. Per-extension shape was already
    // validated at the loader (root requires exclusive; schema must
    // AJV-compile); cross-plugin collision detection happens after
    // every plugin has loaded.
    collectAnnotationContributions(ext.pluginId, instance, bundle.annotationContributions);
    // Step 11.x, same for view contributions. Per-extension shape was
    // already validated at the loader (`contract` against the closed
    // catalog); no cross-plugin collision detection needed because the
    // qualified id `<pluginId>/<extensionId>/<contributionId>` is
    // structurally unique.
    collectViewContributions(ext.pluginId, ext.id, instance, bundle.viewContributions);
  }
}

/**
 * Step 9.6.6, pluck the optional `annotationContributions` map off a
 * loaded extension instance and append one row per entry to the
 * bundle-level catalog. Defaults are filled in (`location: 'namespaced'`,
 * `ownership: 'shared'`) so consumers downstream see a fully-resolved
 * shape. Built-in catalog fields (from `annotations.schema.json`) are
 * NOT collected here, they are not plugin-contributed.
 */
// Linear collector with one type-guard per nesting level (instance →
// map → entry → schema). Cyclomatic count counts every guard; splitting
// per guard would scatter the path-of-truth without making the code
// clearer.
// eslint-disable-next-line complexity
export function collectAnnotationContributions(
  pluginId: string,
  instance: unknown,
  out: IRegisteredAnnotationKey[],
): void {
  if (typeof instance !== 'object' || instance === null) return;
  const raw = (instance as Record<string, unknown>)['annotationContributions'];
  if (typeof raw !== 'object' || raw === null) return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Partial<IAnnotationContribution>;
    if (typeof entry.schema !== 'object' || entry.schema === null) continue;
    out.push({
      pluginId,
      key,
      location: entry.location ?? 'namespaced',
      ownership: entry.ownership ?? 'shared',
      schema: entry.schema as Record<string, unknown>,
    });
  }
}

export function isExtensionInstance(v: unknown): v is { id: string; kind: string; version: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['id'] === 'string' &&
    typeof (v as Record<string, unknown>)['kind'] === 'string' &&
    typeof (v as Record<string, unknown>)['version'] === 'string'
  );
}
