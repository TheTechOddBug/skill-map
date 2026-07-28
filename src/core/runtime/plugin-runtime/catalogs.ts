/**
 * Read-only helpers over the catalog of registered extensions and
 * contribution keys: the contribution-id sweep set persistence consumes,
 * and the manifest filter the registry update path uses to keep
 * disabled built-ins out of `sm help` / `sm plugins list`.
 */

import type {
  IExtractor,
  IAnalyzer,
  IAction,
} from '../../../kernel/extensions/index.js';
import type { TEnabledResolver } from '../../../kernel/config/plugin-resolver.js';
import type { IExtension } from '../../../kernel/registry.js';
import {
  builtInPlugins,
  type IBuiltInPlugin,
} from '../../../plugins/built-ins.js';

import { isPluginEntryEnabled } from './resolver.js';

/**
 * Phase 3 / View contribution system, extract every qualified
 * contribution id (`<pluginId>/<extensionId>/<contributionId>`)
 * declared by the composed extractors + analyzers + actions. Threaded
 * into `IPersistOptions.registeredContributionKeys` so the
 * `scan_contributions` upsert can drop rows belonging to
 * plugins / extensions / contributions no longer in the catalog.
 *
 * Actions are included because an action that declares a scan-time
 * `project()` self-projection emits its own view contributions (e.g.
 * `inspector.action.button`); omitting them here would let the catalog
 * sweep drop their freshly-emitted rows the moment they land.
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
        actions?: readonly IAction[];
      }
    | undefined,
): Set<string> {
  const keys = new Set<string>();
  if (!composed) return keys;
  for (const ext of [...composed.extractors, ...composed.analyzers, ...(composed.actions ?? [])]) {
    addContributionKeysForExtension(ext, keys);
  }
  return keys;
}

/**
 * Fold one extension's declared view contributions into the qualified-id
 * `keys` set. Extracted so `collectRegisteredContributionKeys` stays a
 * flat loop under the complexity budget once the action bucket joined
 * the extractor + analyzer ones.
 *
 * Renamed from `viewContributions` to `ui` with the structure-as-truth
 * refactor; the runtime aggregator keeps reading the manifest-side field
 * by its new name. The runtime catalog field stays `viewContributions`
 * (distinct from the manifest field).
 */
function addContributionKeysForExtension(
  ext: { pluginId: string; id: string; ui?: unknown },
  keys: Set<string>,
): void {
  const raw = ext.ui;
  if (typeof raw !== 'object' || raw === null) return;
  for (const [contributionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    keys.add(`${ext.pluginId}/${ext.id}/${contributionId}`);
  }
}

/**
 * Per-extension enabled filter for built-in registry rows. Used by
 * call sites (scan / scan-compare / watch) that register built-in
 * manifests via `listBuiltIns()` BEFORE the orchestrator runs, without
 * this filter a user-disabled built-in would appear in `sm help` /
 * `sm plugins list` as if it were live. Each extension is independently
 * toggle-able by its qualified id `<plugin>/<ext>`.
 */
export function filterBuiltInManifests(
  manifests: IExtension[],
  resolveEnabled: TEnabledResolver,
): IExtension[] {
  // Build a per-plugin index so the filter can hand `isPluginEntryEnabled`
  // a stable plugin reference. The index is rebuilt every call (cheap,
  // five plugins, ~33 extensions).
  const pluginById = new Map<string, IBuiltInPlugin>();
  for (const plugin of builtInPlugins) pluginById.set(plugin.id, plugin);

  return manifests.filter((m) => {
    const plugin = pluginById.get(m.pluginId);
    if (!plugin) return true; // not a built-in row, leave it alone.
    // `m.stability` flows the experimental gate into the installed
    // default so a disabled-by-default extension stays out of the
    // registry (and therefore `sm help`) until the operator enables it.
    return isPluginEntryEnabled(plugin, m.id, resolveEnabled, m.stability, m.defaultEnabled);
  });
}
