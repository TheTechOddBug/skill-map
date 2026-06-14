/**
 * Buffered settings-state machine for one `<sm-settings-plugin-section>`
 * (one plugin's settings section). Owns the editable per-extension option
 * buffer for the plugin's settings-declaring extensions, the dirty diff,
 * and the collect / reseed / discard transitions the chassis-level
 * `SettingsBufferService` drives.
 *
 * One section == one buffer owner. The section never issues a request:
 * `collectChanges()` projects its dirty extensions to bulk-PATCH change
 * entries (`{ id: '<plugin>/<ext>', settings: { <changed>: value } }`),
 * which the chassis merges with every other owner's changes into the one
 * global Apply. `reseed(plugins)` refreshes the snapshot from the post-
 * write list (picking out THIS plugin's extensions), clearing the dirty
 * markers; `discardChanges()` reverts to the snapshot.
 *
 * Seeding mirrors the historic inline form: each setting starts at the
 * resolved effective value, else the declaration `default`, else a typed
 * blank; secrets always start blank (their value never crosses the wire),
 * and a blank secret on apply means "leave unchanged".
 */

import { computed, signal, type Signal } from '@angular/core';

import type {
  IPluginExtensionApi,
  IPluginExtensionSettingApi,
  IPluginItemApi,
  TSettingValueApi,
} from '../../../models/api';
import type { IPluginChange } from '../../../services/data-source/data-source.port';

import {
  changedSettings,
  extensionSettingsDirty,
  qualifiedKey,
  seedExtensionSettings,
  type TSettingsBuffer,
} from './settings-plugins.utils';

/** One settings-declaring extension paired with its qualified buffer key. */
export interface ISettingsExtension {
  key: string;
  ext: IPluginExtensionApi;
  declarations: readonly IPluginExtensionSettingApi[];
}

export interface IPluginSectionHandle {
  /** The settings-declaring extensions of the current plugin, in order. */
  settingsExtensions: Signal<readonly ISettingsExtension[]>;
  /** Qualified ids whose buffered settings diverge from the snapshot. */
  dirtyIds: Signal<ReadonlySet<string>>;
  /** Current buffered value for one setting (or the empty-string blank). */
  settingValue(key: string, settingId: string): TSettingValueApi;
  /** Buffer a single setting edit (no PATCH until the global apply). */
  onSettingChange(key: string, settingId: string, next: TSettingValueApi): void;
  /** Dirty settings deltas as bulk-PATCH change entries (one per dirty
   *  extension, only the changed keys). Returns `[]` when clean. */
  collectChanges(): IPluginChange[];
  /** Re-seed the snapshot + buffer from a fresh plugin item (same id) so
   *  the dirty markers clear after a global Apply. */
  reseedFrom(plugin: IPluginItemApi): void;
  /** Revert every buffered edit to the snapshot. */
  discardChanges(): void;
}

/**
 * Build the section handle for one plugin item. `plugin` is the initial
 * snapshot; `reseedFrom` replaces it after a global Apply with the post-
 * write item for the same plugin id.
 */
export function setupPluginSection(plugin: IPluginItemApi): IPluginSectionHandle {
  const settingsExtensions = signal<readonly ISettingsExtension[]>(
    collectSettingsExtensions(plugin),
  );

  // Snapshot from the last seed + the editable copy, both keyed by the
  // qualified `<plugin>/<ext>` id. Seeded together; the dirty diff is the
  // delta between them.
  const originalSettings = signal<TSettingsBuffer>(seedBuffer(plugin));
  const pendingSettings = signal<TSettingsBuffer>(cloneBuffer(originalSettings()));

  const dirtyIds = computed<ReadonlySet<string>>(() => {
    const out = new Set<string>();
    const orig = originalSettings();
    const pend = pendingSettings();
    for (const { key, declarations } of settingsExtensions()) {
      if (extensionSettingsDirty(declarations, orig.get(key), pend.get(key))) {
        out.add(key);
      }
    }
    return out;
  });

  const settingValue = (key: string, settingId: string): TSettingValueApi => {
    const v = pendingSettings().get(key)?.[settingId];
    return (v ?? '') as TSettingValueApi;
  };

  const onSettingChange = (
    key: string,
    settingId: string,
    next: TSettingValueApi,
  ): void => {
    const buffer = cloneBuffer(pendingSettings());
    const bucket = { ...(buffer.get(key) ?? {}) };
    bucket[settingId] = next;
    buffer.set(key, bucket);
    pendingSettings.set(buffer);
  };

  const collectChanges = (): IPluginChange[] => {
    const orig = originalSettings();
    const pend = pendingSettings();
    const changes: IPluginChange[] = [];
    for (const { key, declarations } of settingsExtensions()) {
      const patch = changedSettings(declarations, orig.get(key), pend.get(key));
      if (patch !== null) changes.push({ id: key, settings: patch });
    }
    return changes;
  };

  const reseedFrom = (next: IPluginItemApi): void => {
    settingsExtensions.set(collectSettingsExtensions(next));
    const fresh = seedBuffer(next);
    originalSettings.set(fresh);
    pendingSettings.set(cloneBuffer(fresh));
  };

  const discardChanges = (): void => {
    pendingSettings.set(cloneBuffer(originalSettings()));
  };

  return {
    settingsExtensions,
    dirtyIds,
    settingValue,
    onSettingChange,
    collectChanges,
    reseedFrom,
    discardChanges,
  };
}

/** The plugin's settings-declaring extensions, in manifest order. */
function collectSettingsExtensions(plugin: IPluginItemApi): ISettingsExtension[] {
  const out: ISettingsExtension[] = [];
  for (const ext of plugin.extensions ?? []) {
    if (ext.settings && ext.settings.length > 0) {
      out.push({
        key: qualifiedKey(plugin.id, ext.id),
        ext,
        declarations: ext.settings,
      });
    }
  }
  return out;
}

/** Seed the editable buffer for the plugin's settings-declaring
 *  extensions, keyed by qualified id. */
function seedBuffer(plugin: IPluginItemApi): TSettingsBuffer {
  const out: TSettingsBuffer = new Map();
  for (const ext of plugin.extensions ?? []) {
    if (!ext.settings || ext.settings.length === 0) continue;
    out.set(qualifiedKey(plugin.id, ext.id), seedExtensionSettings(ext));
  }
  return out;
}

/** Shallow-per-extension clone (new outer Map + a fresh value record per
 *  entry) so a pending edit never leaks into the snapshot. */
function cloneBuffer(source: TSettingsBuffer): TSettingsBuffer {
  const out: TSettingsBuffer = new Map();
  for (const [key, record] of source) out.set(key, { ...record });
  return out;
}

/** Whether a plugin has at least one settings-declaring extension. The
 *  chassis uses this to decide which plugins get a sidebar section. */
export function pluginHasSettings(plugin: IPluginItemApi): boolean {
  return (plugin.extensions ?? []).some(
    (ext) => (ext.settings?.length ?? 0) > 0,
  );
}
