/**
 * `<sm-settings-plugins>`, Plugins section of the Settings modal.
 *
 * Owns the full lifecycle: fetch on `(visible) === true`, render the
 * list with bundle / per-extension toggles, BUFFER pending changes in
 * `pendingState`, dispatch the bulk `PATCH /api/plugins` via
 * `applyChanges()` (or revert with `discardChanges()`), and trigger
 * a scan after a successful apply so the graph reflects the new state.
 *
 * Splitting this out of `SettingsModal` keeps the chassis (dialog +
 * sidebar) section-agnostic, adding `SettingsGeneral` / `SettingsAbout`
 * later is one new file and one entry in `SETTINGS_SECTIONS` rather
 * than a sprawling parent.
 *
 * Buffered flow (no PATCH per click):
 *
 *   1. `refresh()` snapshots the GET response into `originalState`,
 *      copies it into `pendingState`.
 *   2. Toggle handlers mutate `pendingState` only, the DB stays
 *      untouched until the user confirms.
 *   3. `dirtyIds` (computed) is the diff between the two maps.
 *      The template renders a dot per dirty row and an
 *      "N unsaved changes" banner.
 *   4. `applyChanges()` POSTs the dirty entries as a single
 *      `applyPluginChanges()` call, refreshes `originalState` /
 *      `pendingState` from the response, and triggers a scan.
 *   5. `discardChanges()` resets `pendingState = new Map(originalState)`
 *      so the user can bail without touching the DB.
 *
 * Per-row hint: when a plugin row carries `startsAsDisabled: true`
 * AND the user is re-enabling it in the buffered state, the template
 * shows an inline note that the plugin's handlers were not loaded at
 * boot, re-engaging needs an `sm serve` restart. The apply still
 * goes through (the override is persisted), it just doesn't take
 * effect live.
 *
 * Internal split:
 *   - `plugin-state.controller.ts`   → fetch + buffered toggle state.
 *   - `plugin-filter.controller.ts`  → search + kind filter pipeline.
 *   - `settings-plugins.utils.ts`    → pure projections (filter / sort /
 *                                      label resolvers).
 *   - `settings-plugins.storage.ts`  → localStorage helpers.
 */

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IPluginExtensionApi,
  IPluginItemApi,
} from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { kindTint } from '../../../services/extension-kind-tints';
import { ScanTriggerService } from '../../services/scan-trigger';

import {
  clickedInteractive,
  isFailureStatus,
  qualifiedKey,
  sourceLabel,
  statusLabel,
  type TKindFilter,
} from './settings-plugins.utils';
import { setupPluginCollapse } from './plugin-collapse.controller';
import { setupPluginFilter } from './plugin-filter.controller';
import { setupPluginState } from './plugin-state.controller';

@Component({
  selector: 'sm-settings-plugins',
  imports: [FormsModule, ButtonModule, IconFieldModule, InputIconModule, InputTextModule, MessageModule, ToggleButtonModule, ToggleSwitchModule],
  templateUrl: './settings-plugins.html',
  styleUrl: './settings-plugins.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPlugins {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly scanTrigger = inject(ScanTriggerService);

  /**
   * Section visibility signal. The chassis flips it true when the
   * Plugins section becomes active AND the modal itself is visible;
   * we refresh the list on every transition to true so a flag toggled
   * via `sm plugins enable/disable` from another terminal surfaces on
   * the next view.
   */
  readonly visible = input.required<boolean>();

  /**
   * Emitted after a successful `applyChanges()` so the modal host can
   * close the dialog. The buffered flow's contract is "Apply commits +
   * closes" (mirrored by the confirm-dialog Apply action and the
   * footer Apply button); centralising the close trigger here lets the
   * modal stay agnostic of which path fired the apply. NOT emitted on
   * `discardChanges()` (the user explicitly chose not to persist) nor
   * on apply errors (the buffer stays dirty so the user can retry).
   */
  readonly applied = output<void>();

  protected readonly texts = SETTINGS_TEXTS;

  /**
   * Buffered plugin-state machine, owns the `plugins` list, the
   * `originalState` snapshot, the editable `pendingState`, the
   * `dirtyIds` diff, plus `refresh` / `applyChanges` / `discardChanges`.
   * The component re-exposes signals + wraps imperative entry points
   * so the template binds the same shapes it always has.
   */
  private readonly pluginState = setupPluginState({
    dataSource: this.dataSource,
    scanTrigger: this.scanTrigger,
  });

  /** Raw plugin list, owned by the state controller. */
  protected readonly plugins = this.pluginState.plugins;
  protected readonly loading = this.pluginState.loading;
  protected readonly loadError = this.pluginState.loadError;
  protected readonly toggleError = this.pluginState.toggleError;
  protected readonly applying = this.pluginState.applying;
  protected readonly hasFailureRows = this.pluginState.hasFailureRows;
  protected readonly originalState = this.pluginState.originalState;
  protected readonly pendingState = this.pluginState.pendingState;
  /** Public so the modal host can size its confirm-on-close dialog
   *  and pre-fill the "N unsaved changes" copy. */
  readonly dirtyIds = this.pluginState.dirtyIds;
  readonly hasPendingChanges = this.pluginState.hasPendingChanges;
  protected readonly restartRecommended = this.pluginState.restartRecommended;

  /**
   * Bundle-row collapse state, owned by `plugin-collapse.controller`.
   * The controller rehydrates the persisted set on construction and
   * mirrors subsequent writes back to localStorage; the template
   * binds `collapsed`, `toggleExpanded`, and `isExpanded` verbatim
   * through the protected delegates below.
   */
  private readonly pluginCollapse = setupPluginCollapse();
  protected readonly collapsed = this.pluginCollapse.collapsed;

  /**
   * Search + kind-filter state machine. Owns the writable `searchText`
   * and `kindFilter` signals, the persistence effect for the kind
   * filter, and the `filteredPlugins` derivation pipeline (lock strip
   * → pin sort → kind → search). The template-bound surfaces below
   * (`searchText`, `kindFilterOptions`, etc.) re-expose handles from
   * this controller verbatim, the template binds the same shapes it
   * always has.
   */
  private readonly pluginFilter = setupPluginFilter({ plugins: this.plugins });

  protected readonly searchText = this.pluginFilter.searchText;
  protected readonly searchActive = this.pluginFilter.searchActive;
  protected readonly kindFilter = this.pluginFilter.kindFilter;
  protected readonly kindFilterActive = this.pluginFilter.kindFilterActive;
  protected readonly kindFilterOptions = this.pluginFilter.kindFilterOptions;
  protected readonly visiblePlugins = this.pluginFilter.visiblePlugins;
  protected readonly filteredPlugins = this.pluginFilter.filteredPlugins;

  constructor() {
    effect(() => {
      if (this.visible()) void this.pluginState.refresh();
    });
  }

  protected setKindFilter(kind: TKindFilter): void {
    this.pluginFilter.setKindFilter(kind);
  }

  protected isKindFilterActive(kind: TKindFilter): boolean {
    return this.pluginFilter.isKindFilterActive(kind);
  }

  protected toggleExpanded(id: string): void {
    this.pluginCollapse.toggleExpanded(id);
  }

  protected isExpanded(id: string): boolean {
    return this.pluginCollapse.isExpanded(id);
  }

  /** Current pending value for a toggle key. Used by the template
   *  bindings to drive `[ngModel]` from the buffer instead of the
   *  stale `plugin.status` / `ext.enabled` fields the GET shipped. */
  protected pendingEnabled(id: string): boolean {
    return this.pluginState.pendingEnabled(id);
  }

  /** True when the key's current pending value differs from the
   *  original snapshot. Drives the per-row dirty dot. */
  protected isDirty(id: string): boolean {
    return this.pluginState.isDirty(id);
  }

  /**
   * Per-row hint: only fires when the plugin started disabled at
   * `sm serve` boot AND the user is re-enabling it in the buffered
   * state. The apply still persists the override; the hint just warns
   * the user that the change won't take effect until the server
   * restarts (the handlers were never loaded into memory).
   */
  protected showStartsAsDisabledHint(plugin: IPluginItemApi): boolean {
    if (!plugin.startsAsDisabled) return false;
    return this.pendingEnabled(plugin.id);
  }

  protected onBundleToggle(plugin: IPluginItemApi, nextValue: boolean): void {
    this.pluginState.onBundleToggle(plugin, nextValue);
  }

  protected onExtensionToggle(
    bundleId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void {
    this.pluginState.onExtensionToggle(bundleId, ext, nextValue);
  }

  /**
   * Ship the dirty buffer as a single bulk PATCH (controller call) and
   * emit `applied` on success so the modal host closes. Errors stay
   * inside the controller's `toggleError` signal; the buffer is left
   * intact so the user can retry or discard.
   */
  async applyChanges(): Promise<void> {
    const result = await this.pluginState.applyChanges();
    // Notify the modal host AFTER `applying` flips back so the close
    // animation doesn't race with a still-busy state. Only fires on
    // success, a failed apply keeps the modal open with the buffer
    // intact so the user can retry or discard.
    if (result.ok) this.applied.emit();
  }

  /** Revert every pending edit to the snapshot from the last refresh.
   *  Does NOT touch the DB; the user can re-toggle freely afterwards. */
  discardChanges(): void {
    this.pluginState.discardChanges();
  }

  /**
   * Should the bundle's `<p-toggleswitch>` render at all? False for
   * load-failure rows (the spec has no enabled/disabled axis to flip)
   * and for granularity=extension bundles (the per-extension switches
   * downstairs do the toggling). Locked rows still render the switch
   *, disabled, so the user sees the current enabled state and a
   * "Locked" tag explaining why it cannot move.
   */
  protected canToggleBundle(plugin: IPluginItemApi): boolean {
    if (plugin.granularity === 'extension') return false;
    return !isFailureStatus(plugin.status);
  }

  /** True when the user can actually flip the bundle (renders + lock-free). */
  protected bundleToggleInteractive(plugin: IPluginItemApi): boolean {
    return this.canToggleBundle(plugin) && !plugin.locked;
  }

  /** True when the user can actually flip the extension (lock-free). */
  protected extensionToggleInteractive(ext: IPluginExtensionApi): boolean {
    return !ext.locked;
  }

  /**
   * Whether clicking anywhere on the row should do something useful,
   * either toggle the bundle (when it has a toggle) or expand /
   * collapse the extension list (granularity=extension bundles).
   * Failure rows are inert: no toggle, nothing to expand.
   */
  protected rowIsClickable(plugin: IPluginItemApi): boolean {
    if (this.bundleToggleInteractive(plugin)) return true;
    if (plugin.granularity === 'extension' && (plugin.extensions?.length ?? 0) > 0) {
      return true;
    }
    return false;
  }

  /**
   * Whole-row click handler. Forwards to the toggle when the bundle
   * has one, or flips the expansion when the row is a granularity=
   * extension bundle. Clicks on the chevron / toggle itself are
   * already handled by their own listeners, those stop the event
   * propagation up to here so we never double-fire.
   */
  protected onRowClick(plugin: IPluginItemApi, event: Event): void {
    if (clickedInteractive(event)) return;
    if (this.bundleToggleInteractive(plugin)) {
      this.onBundleToggle(plugin, !this.pendingEnabled(plugin.id));
      return;
    }
    if (plugin.granularity === 'extension' && (plugin.extensions?.length ?? 0) > 0) {
      this.toggleExpanded(plugin.id);
    }
  }

  /** Whole-row click handler for the per-extension subrow. */
  protected onSubrowClick(
    bundleId: string,
    ext: IPluginExtensionApi,
    event: Event,
  ): void {
    if (clickedInteractive(event)) return;
    if (!this.extensionToggleInteractive(ext)) return;
    const key = qualifiedKey(bundleId, ext.id);
    this.onExtensionToggle(bundleId, ext, !this.pendingEnabled(key));
  }

  protected statusLabel(plugin: IPluginItemApi): string {
    return statusLabel(plugin, this.texts);
  }

  protected sourceLabel(source: IPluginItemApi['source']): string {
    return sourceLabel(source, this.texts);
  }

  protected qualifiedExt(bundleId: string, extensionId: string): string {
    return qualifiedKey(bundleId, extensionId);
  }

  /** Resolve the canonical accent color for an extension kind. Used
   *  by the template to set `--kind-color` so the kind tag's bg /
   *  border / fg derive from a single source. */
  protected kindTint(kind: string): string {
    return kindTint(kind);
  }
}
