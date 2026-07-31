/**
 * `ctx.store` composition root, the seam that turns the Mode A KV
 * contract from a declared interface into a working accessor.
 *
 * Three pieces have to meet for a plugin's `ctx.store` to exist:
 *
 *   1. the plugin's `plugin.json` declares `"storage": { "mode": "kv" }`
 *      (discovery already parsed it onto `IDiscoveredPlugin.manifest`);
 *   2. a `StoragePort` is open, so the wrapper has somewhere to write;
 *   3. the orchestrator receives the wrappers as
 *      `RunScanOptions.pluginStores`, keyed by plugin id.
 *
 * This module owns (2) → (1) and hands the result to the caller for
 * (3). `src/core/runtime/scan-runner.ts` calls it inside the open DB
 * scope of a persisting scan; nobody else needs to.
 *
 * The `pluginId` binding happens HERE and nowhere else: each plugin
 * gets its own `IKvStorePersist` closure with its own id baked in, so
 * the wrapper handed to a plugin has no argument through which it
 * could name another plugin's rows. That is the runtime half of
 * `spec/plugin-kv-api.md` § Scoping ("the kernel enforces this when
 * constructing `ctx.store`").
 *
 * Mode B (`mode: 'dedicated'`) is deliberately NOT wired here, and as
 * of the 1.0.0 spec freeze that is the CONTRACT rather than a gap:
 * `plugin-kv-api.md` §Runtime accessor states that a dedicated plugin
 * gets its tables created and namespaced but no runtime accessor in v1.
 * `makePluginStore` returns `undefined` when no dedicated persistence
 * is supplied, so those plugins see `ctx.store === undefined`, which is
 * exactly what the spec now promises.
 */

import { makePluginStore } from '../../kernel/adapters/plugin-store.js';
import type {
  IKvStorePersist,
  TPluginStore,
} from '../../kernel/adapters/plugin-store.js';
import type { IDiscoveredPlugin } from '../../kernel/ports/plugin-loader.js';
import type { StoragePort } from '../../kernel/ports/storage.js';

/** Options bag for `buildPluginStores`. */
export interface IBuildPluginStoresOptions {
  /** Raw discovery output (`IPluginRuntime.discovered`). */
  discovered: readonly IDiscoveredPlugin[];
  /** Open storage port the KV rows land in. */
  port: StoragePort;
  /**
   * Optional advisory sink, forwarded to each wrapper for the soft
   * key-length limit. The CLI passes its printer's warn channel.
   */
  warn?: (message: string) => void;
}

/**
 * Build the `pluginId → store` map the orchestrator threads onto every
 * extractor context.
 *
 * Only plugins that actually loaded (`status: 'enabled'`) and declared
 * storage get an entry; a disabled or failed plugin never runs an
 * extractor, so an entry for it would be dead weight. Returns an empty
 * map when nothing qualifies, which is the common case and costs the
 * orchestrator a single `Map.get` miss per extractor.
 */
export function buildPluginStores(
  options: IBuildPluginStoresOptions,
): ReadonlyMap<string, TPluginStore> {
  const stores = new Map<string, TPluginStore>();
  for (const plugin of options.discovered) {
    if (plugin.status !== 'enabled') continue;
    if (!plugin.manifest?.storage) continue;
    const store = makePluginStore({
      plugin,
      persistKv: makeKvPersist(options.port, plugin.id),
      ...(options.warn ? { warn: options.warn } : {}),
    });
    if (store) stores.set(plugin.id, store);
  }
  return stores;
}

/**
 * Bind the storage port's `pluginKvs` namespace to a single plugin.
 * The returned port is the only surface the KV wrapper can reach, and
 * every method already carries the plugin id, so no caller downstream
 * can widen the scope.
 */
export function makeKvPersist(port: StoragePort, pluginId: string): IKvStorePersist {
  return {
    get: (nodeId, key) => port.pluginKvs.get({ pluginId, nodeId, key }),
    set: (nodeId, key, valueJson, updatedAt) =>
      port.pluginKvs.set({ pluginId, nodeId, key, valueJson, updatedAt }),
    delete: (nodeId, key) => port.pluginKvs.delete({ pluginId, nodeId, key }),
    list: (nodeId, prefix) =>
      port.pluginKvs.list({
        pluginId,
        nodeId,
        ...(prefix === undefined ? {} : { prefix }),
      }),
  };
}
