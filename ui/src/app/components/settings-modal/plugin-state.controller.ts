/**
 * Buffered plugin-state machine for `<sm-settings-plugins>`. Owns the
 * `plugins` list, the `originalState` snapshot, the editable
 * `pendingState` toggle buffer, the `dirtyIds` diff, and the
 * fetch / collect / reseed / discard transitions. Pulled out of the
 * component so the view file stays focused on template wiring + filter /
 * collapse UI concerns.
 *
 * Toggle-only: this controller tracks the per-extension enable/disable
 * axis. Operator settings ("Options" forms) moved OUT of the Plugins
 * panel into the dedicated per-plugin sections (`SettingsPluginSection`),
 * each of which owns its own settings buffer. The controller therefore no
 * longer seeds, diffs, or ships any `settings` patch.
 *
 * Global Apply: the controller does NOT issue the bulk PATCH itself. It
 * exposes `collectChanges()` (its dirty toggle deltas as
 * `IPluginChange[]`) and `reseed(plugins)` (refresh the snapshot from the
 * post-write list); the chassis-level `SettingsBufferService` merges this
 * owner's changes with every other owner's and issues the single PATCH.
 */

import { computed, signal, type Signal, type WritableSignal } from '@angular/core';

import type {
  IPluginExtensionApi,
  IPluginItemApi,
} from '../../../models/api';
import type {
  IDataSourcePort,
  IPluginChange,
} from '../../../services/data-source/data-source.port';

import {
  buildStateFromPlugins,
  formatErr,
  isFailureStatus,
  qualifiedKey,
} from './settings-plugins.utils';

export interface IPluginStateDeps {
  dataSource: IDataSourcePort;
}

export interface IPluginStateHandle {
  plugins: Signal<readonly IPluginItemApi[]>;
  loading: Signal<boolean>;
  loadError: Signal<string | null>;
  /** Writable so the template can call `toggleError.set(null)` to
   *  dismiss the inline error banner without round-tripping through a
   *  component method. */
  toggleError: WritableSignal<string | null>;
  hasFailureRows: Signal<boolean>;
  originalState: Signal<ReadonlyMap<string, boolean>>;
  pendingState: Signal<ReadonlyMap<string, boolean>>;
  dirtyIds: Signal<ReadonlySet<string>>;
  hasPendingChanges: Signal<boolean>;
  restartRecommended: Signal<boolean>;
  pendingEnabled(id: string): boolean;
  isDirty(id: string): boolean;
  refresh(): Promise<void>;
  /**
   * Grant / revoke LOCAL import trust for a plugin via an IMMEDIATE
   * `PATCH /api/plugins/:id/trust` (the security axis is orthogonal to
   * the buffered enable toggles, so it is not staged). On success the
   * post-write list is reconciled into local state WITHOUT discarding any
   * pending enable edits. Errors surface in `toggleError`.
   */
  setTrusted(pluginId: string, trusted: boolean): Promise<void>;
  onExtensionToggle(
    pluginId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void;
  /** Dirty toggle deltas projected as bulk-PATCH change entries. Returns
   *  `[]` when nothing is dirty. Does NOT issue a request. */
  collectChanges(): IPluginChange[];
  /** Re-seed the snapshot + buffer from a post-write plugin list so the
   *  dirty markers clear after a successful global Apply. */
  reseed(plugins: readonly IPluginItemApi[]): void;
  discardChanges(): void;
}

export function setupPluginState(deps: IPluginStateDeps): IPluginStateHandle {
  const loading = signal(false);
  const loadError = signal<string | null>(null);
  const toggleError = signal<string | null>(null);
  const plugins = signal<IPluginItemApi[]>([]);
  const originalState = signal<ReadonlyMap<string, boolean>>(new Map());
  const pendingState = signal<ReadonlyMap<string, boolean>>(new Map());

  /**
   * Ids whose `pendingState` toggle diverges from their snapshot. Drives
   * the per-row dirty dot, the chassis "N unsaved changes" copy, and the
   * collected change payload.
   */
  const dirtyIds = computed<ReadonlySet<string>>(() => {
    const orig = originalState();
    const pend = pendingState();
    const out = new Set<string>();
    for (const [id, enabled] of pend) {
      if (orig.get(id) !== enabled) out.add(id);
    }
    return out;
  });

  const hasPendingChanges = computed(() => dirtyIds().size > 0);

  const hasFailureRows = computed(() =>
    plugins().some((p) => isFailureStatus(p.status)),
  );

  /**
   * Footer-level mirror of `showStartsAsDisabledHint`: `true` when AT
   * LEAST one plugin in the list satisfies the per-row trigger (boot
   * snapshot reports `startsAsDisabled` AND at least one of its
   * extensions is pending re-enable).
   */
  const restartRecommended = computed<boolean>(() => {
    const pending = pendingState();
    for (const plugin of plugins()) {
      if (plugin.startsAsDisabled !== true) continue;
      const extensions = plugin.extensions ?? [];
      for (const ext of extensions) {
        if (pending.get(qualifiedKey(plugin.id, ext.id)) === true) return true;
      }
    }
    return false;
  });

  const pendingEnabled = (id: string): boolean =>
    pendingState().get(id) ?? false;

  const isDirty = (id: string): boolean => dirtyIds().has(id);

  /** Apply a fresh plugin list to the snapshot + buffer, dropping any
   *  pending toggle edits. Shared by `refresh` (GET) and `reseed`
   *  (post-write list). */
  const seedFromList = (items: readonly IPluginItemApi[]): void => {
    plugins.set([...items]);
    const fresh = buildStateFromPlugins(items);
    originalState.set(fresh);
    pendingState.set(new Map(fresh));
  };

  /** Fetch (or re-fetch) the plugin list. Errors surface in `loadError`.
   *  Also resets `originalState` / `pendingState` from the response, so
   *  any pending edits the user had open get discarded on reopen, a
   *  reopen is the user's signal to "start fresh". */
  const refresh = async (): Promise<void> => {
    loading.set(true);
    loadError.set(null);
    toggleError.set(null);
    try {
      const envelope = await deps.dataSource.listPlugins();
      seedFromList(envelope.items);
    } catch (err) {
      loadError.set(formatErr(err));
      plugins.set([]);
      originalState.set(new Map());
      pendingState.set(new Map());
    } finally {
      loading.set(false);
    }
  };

  /**
   * Apply a post-trust-write plugin list while PRESERVING any pending
   * enable edits. Trusting is an immediate security write on a separate
   * axis; it must not silently throw away the operator's buffered enable
   * toggles. We capture the current dirty deltas, re-seed `plugins` +
   * `originalState` from the new list, then replay the still-applicable
   * deltas onto `pendingState`. (An untrusted plugin carries no
   * extensions, so trusting it adds no keys until restart; the merge is a
   * no-op for the common case but stays correct if the BFF ever returns
   * extensions inline.)
   */
  const reconcileAfterTrust = (items: readonly IPluginItemApi[]): void => {
    const prevOriginal = originalState();
    const prevPending = pendingState();
    const deltas = new Map<string, boolean>();
    for (const [key, value] of prevPending) {
      if (prevOriginal.get(key) !== value) deltas.set(key, value);
    }
    plugins.set([...items]);
    const fresh = buildStateFromPlugins(items);
    originalState.set(fresh);
    const nextPending = new Map(fresh);
    for (const [key, value] of deltas) {
      if (nextPending.has(key)) nextPending.set(key, value);
    }
    pendingState.set(nextPending);
    toggleError.set(null);
  };

  const setTrusted = async (
    pluginId: string,
    trusted: boolean,
  ): Promise<void> => {
    toggleError.set(null);
    try {
      const envelope = await deps.dataSource.setPluginTrusted(pluginId, trusted);
      reconcileAfterTrust(envelope.items);
    } catch (err) {
      toggleError.set(formatErr(err));
    }
  };

  const onExtensionToggle = (
    pluginId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void => {
    const key = qualifiedKey(pluginId, ext.id);
    const next = new Map(pendingState());
    next.set(key, nextValue);
    pendingState.set(next);
  };

  /**
   * Project the dirty toggle deltas into bulk-PATCH change entries. Each
   * dirty row ships one `{ id, enabled }` carrying the buffered flag. No
   * request is issued; the chassis merges this with the other owners'
   * changes and PATCHes once.
   */
  const collectChanges = (): IPluginChange[] => {
    const dirty = dirtyIds();
    if (dirty.size === 0) return [];
    const pending = pendingState();
    const changes: IPluginChange[] = [];
    for (const id of dirty) {
      changes.push({ id, enabled: pending.get(id) ?? false });
    }
    return changes;
  };

  /** Re-seed from the post-write list (clears the dirty markers). Also
   *  clears any stale toggle error from a prior failed attempt. */
  const reseed = (items: readonly IPluginItemApi[]): void => {
    seedFromList(items);
    toggleError.set(null);
  };

  /** Revert every pending toggle to the snapshot from the last refresh.
   *  Does NOT touch the DB; the user can re-toggle freely afterwards. */
  const discardChanges = (): void => {
    pendingState.set(new Map(originalState()));
    toggleError.set(null);
  };

  return {
    plugins,
    loading,
    loadError,
    toggleError,
    hasFailureRows,
    originalState,
    pendingState,
    dirtyIds,
    hasPendingChanges,
    restartRecommended,
    pendingEnabled,
    isDirty,
    refresh,
    setTrusted,
    onExtensionToggle,
    collectChanges,
    reseed,
    discardChanges,
  };
}
