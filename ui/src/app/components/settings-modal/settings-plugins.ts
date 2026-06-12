/**
 * `<sm-settings-plugins>`, Plugins section of the Settings modal.
 *
 * Owns the full lifecycle: fetch on `(visible) === true`, render the
 * list with plugin / per-extension toggles, BUFFER pending changes in
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
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
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
  type TSourceChip,
  type TSourceFilter,
} from './settings-plugins.utils';
import { setupPluginCollapse } from './plugin-collapse.controller';
import { setupPluginFilter } from './plugin-filter.controller';
import { setupPluginState } from './plugin-state.controller';
import { SettingsBufferService, type IBufferOwner } from './settings-buffer.service';

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
  private readonly buffer = inject(SettingsBufferService);
  private readonly destroyRef = inject(DestroyRef);

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
   * Plugin-row collapse state, owned by `plugin-collapse.controller`.
   * The controller rehydrates the persisted set on construction and
   * mirrors subsequent writes back to localStorage; the template
   * binds `collapsed`, `toggleExpanded`, and `isExpanded` verbatim
   * through the protected delegates below.
   */
  private readonly pluginCollapse = setupPluginCollapse();
  protected readonly collapsed = this.pluginCollapse.collapsed;

  /**
   * Plugin ids whose runtime-contribution-errors section is expanded.
   * The section is collapsed by DEFAULT (the opposite of the extension
   * list, which defaults expanded), so this set is empty until the user
   * opens a panel. Not persisted: a runtime error is a per-scan
   * diagnostic, re-collapsing on reopen keeps the list tidy.
   */
  private readonly runtimeErrorsExpanded = signal<ReadonlySet<string>>(new Set());

  /**
   * Search + source/kind filter state machine. Owns the writable
   * `searchText`, `sourceFilter` and `kindFilter` signals, the
   * persistence effects, and the `filteredPlugins` derivation pipeline
   * (lock strip → pin sort → source → kind → search). The template-bound
   * surfaces below (`searchText`, `kindFilterChips`, `sourceFilterChips`,
   * `allFilterActive`, etc.) re-expose handles from this controller.
   */
  private readonly pluginFilter = setupPluginFilter({ plugins: this.plugins });

  protected readonly searchText = this.pluginFilter.searchText;
  protected readonly searchActive = this.pluginFilter.searchActive;
  protected readonly kindFilter = this.pluginFilter.kindFilter;
  protected readonly kindFilterActive = this.pluginFilter.kindFilterActive;
  protected readonly kindFilterChips = this.pluginFilter.kindFilterChips;
  protected readonly sourceFilter = this.pluginFilter.sourceFilter;
  protected readonly sourceFilterActive = this.pluginFilter.sourceFilterActive;
  protected readonly sourceFilterChips = this.pluginFilter.sourceFilterChips;
  protected readonly allFilterActive = this.pluginFilter.allFilterActive;
  protected readonly visiblePlugins = this.pluginFilter.visiblePlugins;
  protected readonly filteredPlugins = this.pluginFilter.filteredPlugins;

  /**
   * Whether any project plugin exists. When false, every loaded plugin is
   * built-in, so the built-in / project source filter has nothing to
   * separate: the template hides the two source chips and their divider.
   */
  protected readonly hasProjectPlugins = computed(() =>
    this.plugins().some((plugin) => plugin.source === 'project'),
  );

  constructor() {
    effect(() => {
      if (this.visible()) void this.pluginState.refresh();
    });
    // Register with the chassis-facing buffer service so the close-confirm
    // flow can read `dirtyIds().size` and invoke apply / discard without
    // a `viewChild(SettingsPlugins)` reach across the boundary.
    const owner: IBufferOwner = {
      dirtyIds: this.pluginState.dirtyIds,
      applyChanges: async () => {
        const result = await this.pluginState.applyChanges();
        if (result.ok) this.applied.emit();
        return result;
      },
      discardChanges: () => this.pluginState.discardChanges(),
    };
    this.buffer.register(owner);
    this.destroyRef.onDestroy(() => this.buffer.deregister(owner));
  }

  protected toggleKindFilter(kind: TKindFilter): void {
    this.pluginFilter.toggleKindFilter(kind);
  }

  protected isKindFilterActive(kind: TKindFilter): boolean {
    return this.pluginFilter.isKindFilterActive(kind);
  }

  protected toggleSourceFilter(source: TSourceChip): void {
    this.pluginFilter.toggleSourceFilter(source);
  }

  protected isSourceFilterActive(source: TSourceFilter): boolean {
    return this.pluginFilter.isSourceFilterActive(source);
  }

  protected resetFilters(): void {
    this.pluginFilter.resetFilters();
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
   * `sm serve` boot AND the user is re-enabling at least one of its
   * extensions in the buffered state. The apply still persists the
   * override; the hint just warns the user that the change won't take
   * effect until the server restarts (the handlers were never loaded
   * into memory).
   */
  protected showStartsAsDisabledHint(plugin: IPluginItemApi): boolean {
    if (!plugin.startsAsDisabled) return false;
    if (!plugin.extensions) return false;
    return plugin.extensions.some((ext) =>
      this.pendingEnabled(qualifiedKey(plugin.id, ext.id)),
    );
  }

  protected onExtensionToggle(
    pluginId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void {
    this.pluginState.onExtensionToggle(pluginId, ext, nextValue);
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
   * Whether this row should expose the chevron + per-extension list.
   * True for any plugin that declares at least one extension on the
   * wire. The plugin has no toggle axis of its own; the chevron is
   * the only row-level affordance.
   */
  protected canExpandExtensions(plugin: IPluginItemApi): boolean {
    return (plugin.extensions?.length ?? 0) > 0;
  }

  /** True when the user can actually flip the extension (lock-free). */
  protected extensionToggleInteractive(ext: IPluginExtensionApi): boolean {
    return !ext.locked;
  }

  /**
   * Whether clicking anywhere on the row should do something useful:
   * expand / collapse the per-extension list when the plugin declares
   * any. Failure rows are inert (nothing to expand).
   */
  protected rowIsClickable(plugin: IPluginItemApi): boolean {
    return this.canExpandExtensions(plugin);
  }

  /**
   * Whole-row click handler. The plugin has no toggle of its own, so
   * the row click expands / collapses the extension list. Clicks on
   * the chevron or per-extension toggles are already handled by their
   * own listeners and stop propagation, this handler only fires when
   * the click landed on neutral row chrome.
   */
  protected onRowClick(plugin: IPluginItemApi, event: Event): void {
    if (clickedInteractive(event)) return;
    if (this.canExpandExtensions(plugin)) {
      this.toggleExpanded(plugin.id);
    }
  }

  /** Whole-row click handler for the per-extension subrow. */
  protected onSubrowClick(
    pluginId: string,
    ext: IPluginExtensionApi,
    event: Event,
  ): void {
    if (clickedInteractive(event)) return;
    if (!this.extensionToggleInteractive(ext)) return;
    const key = qualifiedKey(pluginId, ext.id);
    this.onExtensionToggle(pluginId, ext, !this.pendingEnabled(key));
  }

  protected statusLabel(plugin: IPluginItemApi): string {
    return statusLabel(plugin, this.texts);
  }

  /**
   * True for the load-failure statuses (`invalid-manifest`,
   * `incompatible-spec`, `load-error`, `id-collision`), where the plugin
   * was rejected whole and none of its extensions loaded. Drives the red
   * `✕ <status>` badge + the dimmed row; user-disabled plugins are NOT
   * failures (that is an intentional toggle, no badge).
   */
  protected isFailed(plugin: IPluginItemApi): boolean {
    return isFailureStatus(plugin.status);
  }

  /**
   * Count of view-contribution emissions the kernel rejected for this
   * plugin during the last scan. Zero when the optional wire field is
   * absent (the common case) or empty. Drives the warning-toned count
   * badge + the collapsible diagnostics section, independent of the
   * load-status failure badge (`isFailed`).
   */
  protected runtimeErrorCount(plugin: IPluginItemApi): number {
    return plugin.runtimeContributionErrors?.length ?? 0;
  }

  /** True when the plugin carries at least one runtime contribution
   *  error, so the row should render the warning badge + the
   *  collapsible diagnostics section. */
  protected hasRuntimeErrors(plugin: IPluginItemApi): boolean {
    return this.runtimeErrorCount(plugin) > 0;
  }

  /** Whether the runtime-errors section for this plugin is open. */
  protected isRuntimeErrorsExpanded(id: string): boolean {
    return this.runtimeErrorsExpanded().has(id);
  }

  /** Toggle the per-plugin runtime-errors section (collapsed by default). */
  protected toggleRuntimeErrors(id: string): void {
    const next = new Set(this.runtimeErrorsExpanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.runtimeErrorsExpanded.set(next);
  }

  protected sourceLabel(source: IPluginItemApi['source']): string {
    return sourceLabel(source, this.texts);
  }

  protected qualifiedExt(pluginId: string, extensionId: string): string {
    return qualifiedKey(pluginId, extensionId);
  }

  /** Resolve the canonical accent color for an extension kind. Used
   *  by the template to set `--kind-color` so the kind tag's bg /
   *  border / fg derive from a single source. */
  protected kindTint(kind: string): string {
    return kindTint(kind);
  }

  /**
   * Badge label for an extension's lifecycle stage. `null` (no badge)
   * for a missing field, an explicit `stable`, or an unknown value
   * from a newer wire shape; only the non-default stages render.
   */
  protected stabilityLabel(stability: IPluginExtensionApi['stability']): string | null {
    if (!stability || stability === 'stable') return null;
    return this.texts.stability[stability] ?? null;
  }

  /** Severity token backing the stability badge's tint, threaded into
   *  the template as `--stability-color` (same pattern as the kind
   *  chip's `--kind-color`). */
  protected stabilityTint(stability: IPluginExtensionApi['stability']): string {
    if (stability === 'deprecated') return 'var(--sm-severity-error)';
    if (stability === 'experimental') return 'var(--sm-severity-warn)';
    return 'var(--sm-severity-info)';
  }
}
