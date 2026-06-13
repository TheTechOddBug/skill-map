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
  IPluginExtensionSettingApi,
  IPluginItemApi,
  TSettingValueApi,
} from '../../../models/api';
import type {
  IDataSourcePort,
  IPluginChange,
} from '../../../services/data-source/data-source.port';
import type { ScanTriggerService } from '../../services/scan-trigger';
import { captureUiUsage } from '../../core/telemetry/posthog-init';
import { buildPluginUsageSet } from '../../core/telemetry/usage-collector';

import {
  buildSettingsFromPlugins,
  buildStateFromPlugins,
  changedSettings,
  extensionSettingsDirty,
  formatErr,
  isFailureStatus,
  qualifiedKey,
  type TSettingsBuffer,
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
  /** Editable per-extension settings buffer, keyed by qualified id. */
  pendingSettings: Signal<TSettingsBuffer>;
  dirtyIds: Signal<ReadonlySet<string>>;
  hasPendingChanges: Signal<boolean>;
  restartRecommended: Signal<boolean>;
  pendingEnabled(id: string): boolean;
  isDirty(id: string): boolean;
  /** Current pending value for one setting under one extension. */
  pendingSettingValue(key: string, settingId: string): TSettingValueApi | undefined;
  /** Whether the row's pending settings differ from the snapshot. */
  isSettingsDirty(key: string, declarations: readonly IPluginExtensionSettingApi[] | undefined): boolean;
  refresh(): Promise<void>;
  onExtensionToggle(
    pluginId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void;
  /** Buffer a single setting edit (no PATCH until apply). */
  onSettingChange(
    pluginId: string,
    extensionId: string,
    settingId: string,
    nextValue: TSettingValueApi,
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
  // Parallel per-extension settings buffers (keyed by qualified id).
  // `originalSettings` is the snapshot from the last GET; `pendingSettings`
  // is the editable copy. Both are seeded together with the toggle state.
  const originalSettings = signal<TSettingsBuffer>(new Map());
  const pendingSettings = signal<TSettingsBuffer>(new Map());
  const applying = signal(false);

  /**
   * Per-extension declarations keyed by qualified id, derived from the
   * current `plugins` list. Used by the dirty diff + apply payload to
   * know each setting's type (secret vs not, numeric, etc.) without
   * threading the declaration through every call site.
   */
  const declarationsByKey = computed<Map<string, IPluginExtensionSettingApi[]>>(() => {
    const out = new Map<string, IPluginExtensionSettingApi[]>();
    for (const plugin of plugins()) {
      for (const ext of plugin.extensions ?? []) {
        if (ext.settings && ext.settings.length > 0) {
          out.set(qualifiedKey(plugin.id, ext.id), ext.settings);
        }
      }
    }
    return out;
  });

  /**
   * Ids whose `pendingState` toggle OR `pendingSettings` values diverge
   * from their snapshot. Drives the per-row dirty dot, the "N unsaved
   * changes" banner, and the footer's Apply / Discard enablement. A row
   * appears once even when both its toggle and a setting changed.
   */
  const dirtyIds = computed<ReadonlySet<string>>(() => {
    const orig = originalState();
    const pend = pendingState();
    const out = new Set<string>();
    for (const [id, enabled] of pend) {
      if (orig.get(id) !== enabled) out.add(id);
    }
    const decls = declarationsByKey();
    const origS = originalSettings();
    const pendS = pendingSettings();
    for (const [key, declarations] of decls) {
      if (out.has(key)) continue;
      if (extensionSettingsDirty(declarations, origS.get(key), pendS.get(key))) {
        out.add(key);
      }
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

  const pendingSettingValue = (
    key: string,
    settingId: string,
  ): TSettingValueApi | undefined => pendingSettings().get(key)?.[settingId];

  const isSettingsDirty = (
    key: string,
    declarations: readonly IPluginExtensionSettingApi[] | undefined,
  ): boolean =>
    extensionSettingsDirty(
      declarations,
      originalSettings().get(key),
      pendingSettings().get(key),
    );

  /** Fetch (or re-fetch) the plugin list. Errors surface in
   *  `loadError`. Also resets `originalState` / `pendingState` from the
   *  response, so any pending edits the user had open get discarded on
   *  reopen, a reopen is the user's signal to "start fresh". */
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
      const freshSettings = buildSettingsFromPlugins(envelope.items);
      originalSettings.set(freshSettings);
      pendingSettings.set(cloneSettingsBuffer(freshSettings));
    } catch (err) {
      loadError.set(formatErr(err));
      plugins.set([]);
      originalState.set(new Map());
      pendingState.set(new Map());
      originalSettings.set(new Map());
      pendingSettings.set(new Map());
    } finally {
      loading.set(false);
    }
  };

  const onExtensionToggle = (
    pluginId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void => {
    if (applying()) return;
    const key = qualifiedKey(pluginId, ext.id);
    const next = new Map(pendingState());
    next.set(key, nextValue);
    pendingState.set(next);
  };

  const onSettingChange = (
    pluginId: string,
    extensionId: string,
    settingId: string,
    nextValue: TSettingValueApi,
  ): void => {
    if (applying()) return;
    const key = qualifiedKey(pluginId, extensionId);
    const next = cloneSettingsBuffer(pendingSettings());
    const bucket = { ...(next.get(key) ?? {}) };
    bucket[settingId] = nextValue;
    next.set(key, bucket);
    pendingSettings.set(next);
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
    // Each dirty row ships one change carrying whatever axis actually
    // moved: the toggle (when it differs from the snapshot), the settings
    // patch (only the changed keys), or both. A row can be dirty for
    // either reason, so guard each axis independently.
    const changes: IPluginChange[] = [];
    const pending = pendingState();
    const origState = originalState();
    const decls = declarationsByKey();
    const origS = originalSettings();
    const pendS = pendingSettings();
    for (const id of dirty) {
      const change: IPluginChange = { id };
      const pendingFlag = pending.get(id) ?? false;
      if (origState.get(id) !== pendingFlag) change.enabled = pendingFlag;
      const settingsPatch = changedSettings(decls.get(id), origS.get(id), pendS.get(id));
      if (settingsPatch !== null) change.settings = settingsPatch;
      // Defensive: a dirty id always has at least one axis; skip an
      // empty change so the BFF never sees an `{ id }`-only entry.
      if (change.enabled !== undefined || change.settings !== undefined) {
        changes.push(change);
      }
    }
    if (changes.length === 0) return { ok: false };
    applying.set(true);
    toggleError.set(null);
    let success = false;
    try {
      const envelope = await deps.dataSource.applyPluginChanges(changes);
      plugins.set([...envelope.items]);
      const fresh = buildStateFromPlugins(envelope.items);
      originalState.set(fresh);
      pendingState.set(new Map(fresh));
      // Reseed the settings buffers from the post-write projection so the
      // dirty markers clear (secrets re-blank, applied values become the
      // new snapshot).
      const freshSettings = buildSettingsFromPlugins(envelope.items);
      originalSettings.set(freshSettings);
      pendingSettings.set(cloneSettingsBuffer(freshSettings));
      // Fire a scan so the graph picks up the new contribution set.
      // The trigger service guards against concurrent runs and owns
      // the topbar spinner, both surfaces stay consistent.
      void deps.scanTrigger.run();
      success = true;
    } catch (err) {
      toggleError.set(formatErr(err));
    } finally {
      applying.set(false);
    }
    if (success) {
      // Usage analytics (opt-in, no-op unless active): which plugins this
      // Apply explicitly enabled / disabled. Only changes that carry a
      // toggle delta count; settings-only changes (no `enabled`) are
      // excluded from both buckets. Built-in ids pass through,
      // third-party collapse to `external_plugin`. See spec/telemetry.md.
      captureUiUsage('plugin.apply', {
        enabled: buildPluginUsageSet(
          changes.filter((c) => c.enabled === true).map((c) => c.id),
        ),
        disabled: buildPluginUsageSet(
          changes.filter((c) => c.enabled === false).map((c) => c.id),
        ),
      });
    }
    return { ok: success };
  };

  /** Revert every pending edit to the snapshot from the last refresh.
   *  Does NOT touch the DB; the user can re-toggle freely afterwards. */
  const discardChanges = (): void => {
    pendingState.set(new Map(originalState()));
    pendingSettings.set(cloneSettingsBuffer(originalSettings()));
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
    pendingSettings,
    dirtyIds,
    hasPendingChanges,
    restartRecommended,
    pendingEnabled,
    isDirty,
    pendingSettingValue,
    isSettingsDirty,
    refresh,
    onExtensionToggle,
    onSettingChange,
    applyChanges,
    discardChanges,
  };
}

/**
 * Shallow-per-extension clone of a settings buffer: a new outer Map plus
 * a fresh value record per entry, so mutating one extension's pending
 * bucket never leaks into the snapshot. The inner values (arrays /
 * key-value rows) are replaced wholesale on edit, never mutated in
 * place, so a one-level copy of the record is enough.
 */
function cloneSettingsBuffer(source: TSettingsBuffer): TSettingsBuffer {
  const out: TSettingsBuffer = new Map();
  for (const [key, record] of source) {
    out.set(key, { ...record });
  }
  return out;
}
