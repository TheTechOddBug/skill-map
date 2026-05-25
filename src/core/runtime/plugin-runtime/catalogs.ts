/**
 * Read-only helpers over the catalog of registered extensions and
 * contribution keys: the contribution-id sweep set persistence consumes,
 * and the manifest filter the registry update path uses to keep
 * disabled built-ins out of `sm help` / `sm plugins list`.
 */

import type {
  IExtractor,
  IAnalyzer,
} from '../../../kernel/extensions/index.js';
import type { IExtension } from '../../../kernel/registry.js';
import {
  builtInBundles,
  type IBuiltInBundle,
} from '../../../plugins/built-ins.js';

import { isBundleEntryEnabled } from './resolver.js';

/**
 * Phase 3 / View contribution system, extract every qualified
 * contribution id (`<pluginId>/<extensionId>/<contributionId>`)
 * declared by the composed extractors + analyzers. Threaded into
 * `IPersistOptions.registeredContributionKeys` so the
 * `scan_contributions` upsert can drop rows belonging to
 * plugins / extensions / contributions no longer in the catalog.
 *
 * Returns an empty set when `composed` is undefined (zero-extension
 * scans) so the caller can pass it through unconditionally, the
 * adapter then falls back to the legacy "no catalog sweep" path.
 */
export function collectRegisteredContributionKeys(
  composed:
    | {
        extractors: readonly IExtractor[];
        analyzers: readonly IAnalyzer[];
      }
    | undefined,
): Set<string> {
  const keys = new Set<string>();
  if (!composed) return keys;
  for (const ext of [...composed.extractors, ...composed.analyzers]) {
    // Renamed from `viewContributions` to `ui` with the structure-as-truth
    // refactor; the runtime aggregator keeps reading the manifest-side
    // field by its new name. The bundle field stays `viewContributions`
    // (the registered-catalog name, distinct from the manifest field).
    const raw = (ext as { ui?: unknown }).ui;
    if (typeof raw !== 'object' || raw === null) continue;
    for (const [contributionId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      keys.add(`${ext.pluginId}/${ext.id}/${contributionId}`);
    }
  }
  return keys;
}

/**
 * Per-extension enabled filter for built-in registry rows. Used by
 * call sites (scan / scan-compare / watch) that register built-in
 * manifests via `listBuiltIns()` BEFORE the orchestrator runs, without
 * this filter a user-disabled built-in would appear in `sm help` /
 * `sm plugins list` as if it were live. Each extension is independently
 * toggle-able by its qualified id `<bundle>/<ext>`.
 */
export function filterBuiltInManifests(
  manifests: IExtension[],
  resolveEnabled: (id: string) => boolean,
): IExtension[] {
  // Build a per-bundle index so the filter can hand `isBundleEntryEnabled`
  // a stable bundle reference. The index is rebuilt every call (cheap,
  // five bundles, ~33 extensions).
  const bundleByPluginId = new Map<string, IBuiltInBundle>();
  for (const bundle of builtInBundles) bundleByPluginId.set(bundle.id, bundle);

  return manifests.filter((m) => {
    const bundle = bundleByPluginId.get(m.pluginId);
    if (!bundle) return true; // not a built-in row, leave it alone.
    return isBundleEntryEnabled(bundle, m.id, resolveEnabled);
  });
}
