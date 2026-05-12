/**
 * Buffered plugin-state machine for `<sm-settings-plugins>`. Owns the
 * `plugins` list, the `originalState` snapshot, the editable
 * `pendingState` buffer, the `dirtyIds` diff, and the
 * fetch/apply/discard transitions. Pulled out of the component so the
 * view file stays focused on template wiring + filter / collapse UI
 * concerns.
 *
 * The handle returned by `setupPluginState` mirrors the existing
 * component surface: signals stay public so the template re-exposes
 * them verbatim, and the imperative entry points (`refresh`,
 * `applyChanges`, `discardChanges`) preserve the same call shapes the
 * existing tests assert against. The single behavioural change is
 * `applyChanges` returning a `{ ok: boolean }` result instead of
 * firing the `applied` output directly: the component owns the output,
 * and wraps the result so the close-on-success contract stays intact.
 */

import { computed, signal, type Signal, type WritableSignal } from '@angular/core';

import type {
  IPluginExtensionApi,
  IPluginItemApi,
} from '../../../models/api';
import type { IDataSourcePort } from '../../../services/data-source/data-source.port';
import type { ScanTriggerService } from '../../services/scan-trigger';

import {
  buildStateFromPlugins,
  formatErr,
  isFailureStatus,
  qualifiedKey,
} from './settings-plugins.utils';

export interface IPluginStateDeps {
  dataSource: IDataSourcePort;
  scanTrigger: Pick<ScanTriggerService, 'run'>;
}

export interface IPluginStateHandle {
  plugins: Signal<readonly IPluginItemApi[]>;
  loading: Signal<boolean>;
  loadError: Signal<string | null>;
  /** Writable so the template can call `toggleError.set(null)` to
   *  dismiss the inline error banner without round-tripping through a
   *  component method. */
  toggleError: WritableSignal<string | null>;
  applying: Signal<boolean>;
  hasFailureRows: Signal<boolean>;
  originalState: Signal<ReadonlyMap<string, boolean>>;
  pendingState: Signal<ReadonlyMap<string, boolean>>;
  dirtyIds: Signal<ReadonlySet<string>>;
  hasPendingChanges: Signal<boolean>;
  restartRecommended: Signal<boolean>;
  pendingEnabled(id: string): boolean;
  isDirty(id: string): boolean;
  refresh(): Promise<void>;
  onBundleToggle(plugin: IPluginItemApi, nextValue: boolean): void;
  onExtensionToggle(
    bundleId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void;
  applyChanges(): Promise<{ ok: boolean }>;
  discardChanges(): void;
}

export function setupPluginState(deps: IPluginStateDeps): IPluginStateHandle {
  const loading = signal(false);
  const loadError = signal<string | null>(null);
  const toggleError = signal<string | null>(null);
  const plugins = signal<IPluginItemApi[]>([]);
  const originalState = signal<ReadonlyMap<string, boolean>>(new Map());
  const pendingState = signal<ReadonlyMap<string, boolean>>(new Map());
  const applying = signal(false);

  /**
   * Ids whose `pendingState` value diverges from `originalState`.
   * Drives the per-row dirty dot, the "N unsaved changes" banner, and
   * the footer's Apply / Discard enablement.
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
   * snapshot reports `startsAsDisabled` AND pending state is enabled).
   */
  const restartRecommended = computed<boolean>(() => {
    const pending = pendingState();
    for (const plugin of plugins()) {
      if (plugin.startsAsDisabled !== true) continue;
      if (pending.get(plugin.id) === true) return true;
    }
    return false;
  });

  const pendingEnabled = (id: string): boolean =>
    pendingState().get(id) ?? false;

  const isDirty = (id: string): boolean => dirtyIds().has(id);

  /** Fetch (or re-fetch) the plugin list. Errors surface in
   *  `loadError`. Also resets `originalState` / `pendingState` from the
   *  response, so any pending edits the user had open get discarded on
   *  reopen — a reopen is the user's signal to "start fresh". */
  const refresh = async (): Promise<void> => {
    loading.set(true);
    loadError.set(null);
    toggleError.set(null);
    try {
      const envelope = await deps.dataSource.listPlugins();
      plugins.set([...envelope.items]);
      const fresh = buildStateFromPlugins(envelope.items);
      originalState.set(fresh);
      pendingState.set(new Map(fresh));
    } catch (err) {
      loadError.set(formatErr(err));
      plugins.set([]);
      originalState.set(new Map());
      pendingState.set(new Map());
    } finally {
      loading.set(false);
    }
  };

  const onBundleToggle = (
    plugin: IPluginItemApi,
    nextValue: boolean,
  ): void => {
    if (applying()) return;
    const next = new Map(pendingState());
    next.set(plugin.id, nextValue);
    pendingState.set(next);
  };

  const onExtensionToggle = (
    bundleId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void => {
    if (applying()) return;
    const key = qualifiedKey(bundleId, ext.id);
    const next = new Map(pendingState());
    next.set(key, nextValue);
    pendingState.set(next);
  };

  /**
   * Ship the dirty buffer as a single bulk PATCH. On success: refresh
   * `originalState` / `pendingState` from the response, clear the
   * dirty set, and trigger a scan so the graph reflects the new state.
   * Errors surface in `toggleError` and leave the buffer intact so
   * the user can retry or discard. The caller (`SettingsPlugins`)
   * inspects the returned `{ ok }` flag to decide whether to emit
   * `applied` and close the modal.
   */
  const applyChanges = async (): Promise<{ ok: boolean }> => {
    if (applying()) return { ok: false };
    const dirty = dirtyIds();
    if (dirty.size === 0) return { ok: false };
    const changes: Array<{ id: string; enabled: boolean }> = [];
    const pending = pendingState();
    for (const id of dirty) {
      changes.push({ id, enabled: pending.get(id) ?? false });
    }
    applying.set(true);
    toggleError.set(null);
    let success = false;
    try {
      const envelope = await deps.dataSource.applyPluginChanges(changes);
      plugins.set([...envelope.items]);
      const fresh = buildStateFromPlugins(envelope.items);
      originalState.set(fresh);
      pendingState.set(new Map(fresh));
      // Fire a scan so the graph picks up the new contribution set.
      // The trigger service guards against concurrent runs and owns
      // the topbar spinner — both surfaces stay consistent.
      void deps.scanTrigger.run();
      success = true;
    } catch (err) {
      toggleError.set(formatErr(err));
    } finally {
      applying.set(false);
    }
    return { ok: success };
  };

  /** Revert every pending edit to the snapshot from the last refresh.
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
    applying,
    hasFailureRows,
    originalState,
    pendingState,
    dirtyIds,
    hasPendingChanges,
    restartRecommended,
    pendingEnabled,
    isDirty,
    refresh,
    onBundleToggle,
    onExtensionToggle,
    applyChanges,
    discardChanges,
  };
}
