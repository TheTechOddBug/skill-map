/**
 * `<sm-settings-plugins>` — Plugins section of the Settings modal.
 *
 * Owns the full lifecycle: fetch on `(visible) === true`, render the
 * list with bundle / per-extension toggles, BUFFER pending changes in
 * `pendingState`, dispatch the bulk `PATCH /api/plugins` via
 * `applyChanges()` (or revert with `discardChanges()`), and trigger
 * a scan after a successful apply so the graph reflects the new state.
 *
 * Splitting this out of `SettingsModal` keeps the chassis (dialog +
 * sidebar) section-agnostic — adding `SettingsGeneral` / `SettingsAbout`
 * later is one new file and one entry in `SETTINGS_SECTIONS` rather
 * than a sprawling parent.
 *
 * Buffered flow (no PATCH per click):
 *
 *   1. `refresh()` snapshots the GET response into `originalState`,
 *      copies it into `pendingState`.
 *   2. Toggle handlers mutate `pendingState` only — the DB stays
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
 * boot — re-engaging needs an `sm serve` restart. The apply still
 * goes through (the override is persisted), it just doesn't take
 * effect live.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  KIND_FILTER_OPTIONS,
  buildStateFromPlugins,
  clickedInteractive,
  filterByKind,
  filterBySearch,
  formatErr,
  isFailureStatus,
  qualifiedKey,
  sortPluginsByPin,
  stripLocked,
  type TKindFilter,
} from './settings-plugins.utils';
import {
  readStoredCollapsed,
  readStoredKindFilter,
  writeStoredCollapsed,
  writeStoredKindFilter,
} from './settings-plugins.storage';

@Component({
  selector: 'sm-settings-plugins',
  imports: [FormsModule, ButtonModule, IconFieldModule, InputIconModule, InputTextModule, MessageModule, ToggleSwitchModule],
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
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly toggleError = signal<string | null>(null);
  protected readonly plugins = signal<IPluginItemApi[]>([]);
  /**
   * Bundles the user has explicitly **collapsed**. Granularity=extension
   * rows default to **expanded** so the contents (e.g. `core`'s rules
   * and parsers) are visible without an extra click; collapsing flips a
   * row into this set, expanding removes it. Bundle-granularity rows
   * never render a chevron, so they never appear here.
   *
   * Initial value is rehydrated from localStorage so a session-to-
   * session reopen lands on the user's last layout (e.g. `core`
   * collapsed stays collapsed). An effect in the constructor mirrors
   * subsequent writes back into storage.
   */
  protected readonly collapsed = signal<Set<string>>(readStoredCollapsed());

  /**
   * Snapshot of the toggleable state at the last `refresh()` (modal
   * open or post-apply). Keyed by the same id the bulk endpoint
   * accepts: bundle id (`claude`) for `granularity: 'bundle'` rows,
   * qualified `<bundle>/<ext>` (`core/superseded`) for individual
   * extensions of `granularity: 'extension'` bundles. Failure rows
   * (no toggle axis) are excluded. Treated as immutable between
   * refreshes — `applyChanges()` rebuilds it from the response.
   */
  protected readonly originalState = signal<ReadonlyMap<string, boolean>>(new Map());

  /**
   * Editable buffer the toggle handlers mutate. Initialised from
   * `originalState` on every refresh; `applyChanges()` ships the diff;
   * `discardChanges()` resets back to `originalState`. The template
   * binds each switch to this map's value, so the UI reflects pending
   * edits before any DB write.
   */
  protected readonly pendingState = signal<ReadonlyMap<string, boolean>>(new Map());

  /** In-flight flag for the bulk apply call. Disables the toggles +
   *  footer buttons while the PATCH is travelling. Distinct from the
   *  `scanTrigger.scanning` signal (which gates the topbar refresh). */
  protected readonly applying = signal(false);

  /**
   * Ids whose `pendingState` value diverges from `originalState`. Drives
   * the per-row dirty dot, the "N unsaved changes" banner, and the
   * footer's Apply / Discard enablement. Public so the modal host
   * (`SettingsModal`) can read the count when intercepting close
   * attempts to decide whether to open a confirm dialog.
   */
  readonly dirtyIds = computed<ReadonlySet<string>>(() => {
    const orig = this.originalState();
    const pend = this.pendingState();
    const out = new Set<string>();
    for (const [id, enabled] of pend) {
      if (orig.get(id) !== enabled) out.add(id);
    }
    return out;
  });

  /** Convenience derived signal for the template AND the modal host. */
  readonly hasPendingChanges = computed(() => this.dirtyIds().size > 0);

  protected readonly hasFailureRows = computed(() =>
    this.plugins().some((p) => isFailureStatus(p.status)),
  );

  /**
   * Quick filter for the section. Case-insensitive substring match
   * across **bundle ids AND extension ids** (only granularity=extension
   * bundles expose extensions). Empty string short-circuits so the
   * common path stays cheap.
   *
   * Match semantics:
   *   - bundle id matches → keep the row with **all** its extensions
   *     (the user's target was the bundle as a whole).
   *   - bundle id does NOT match but one or more extensions do → keep
   *     the bundle row with the **filtered** extension list, and
   *     force the row expanded so the hits are visible without the
   *     user clicking the chevron.
   */
  protected readonly searchText = signal('');
  protected readonly searchActive = computed(
    () => this.searchText().trim().length > 0,
  );

  /**
   * Single-select kind filter. `'all'` is the neutral default and
   * short-circuits filtering. Picking any other value narrows to
   * extensions whose `kind` matches. Granularity=bundle rows match
   * on their aggregated `kinds` field (the BFF stamps it from the
   * underlying extension list) — without that, picking "Provider"
   * would hide the three vendor provider bundles (`claude`, `gemini`,
   * `agent-skills`), the opposite of what the user expects.
   *
   * Persisted across sessions (mirrors the `collapsed` set) so the
   * user's last view sticks until they change it.
   */
  protected readonly kindFilter = signal<TKindFilter>(readStoredKindFilter());
  protected readonly kindFilterActive = computed(
    () => this.kindFilter() !== 'all',
  );
  protected readonly kindFilterOptions = KIND_FILTER_OPTIONS;
  /**
   * Plugins after stripping host-locked rows. Locked entries are still
   * served by `GET /api/plugins` (CLI surfaces them, future UI may
   * want a "show locked" toggle) but Settings hides them entirely:
   * the toggle cannot move and a "Locked" tag on always-on extensions
   * just adds noise. Lock enforcement (kernel resolver, BFF PATCH 403,
   * CLI exit 5) is unchanged — only the UI listing is filtered.
   *
   * Applied BEFORE search / kind filters so every downstream filter
   * operates on the visible set.
   */
  protected readonly visiblePlugins = computed(() =>
    sortPluginsByPin(this.plugins().flatMap(stripLocked)),
  );
  protected readonly filteredPlugins = computed(() => {
    const query = this.searchText().trim().toLowerCase();
    const kind = this.kindFilter();
    let list = this.visiblePlugins();
    if (kind !== 'all') {
      list = list.flatMap((plugin) => filterByKind(plugin, kind));
    }
    if (query.length > 0) {
      list = list.flatMap((plugin) => filterBySearch(plugin, query));
    }
    return list;
  });
  constructor() {
    effect(() => {
      if (this.visible()) void this.refresh();
    });
    // Mirror UI-state signals into localStorage. Effects fire on every
    // change, including programmatic ones, so the toggle / setKindFilter
    // helpers don't have to remember to persist.
    effect(() => writeStoredCollapsed(this.collapsed()));
    effect(() => writeStoredKindFilter(this.kindFilter()));
  }

  /** Fetch (or re-fetch) the plugin list. Errors surface in `loadError`.
   *  Also resets `originalState` / `pendingState` from the response, so
   *  any pending edits the user had open get discarded on reopen — a
   *  reopen is the user's signal to "start fresh". */
  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.toggleError.set(null);
    try {
      const envelope = await this.dataSource.listPlugins();
      this.plugins.set([...envelope.items]);
      const fresh = buildStateFromPlugins(envelope.items);
      this.originalState.set(fresh);
      this.pendingState.set(new Map(fresh));
    } catch (err) {
      this.loadError.set(formatErr(err));
      this.plugins.set([]);
      this.originalState.set(new Map());
      this.pendingState.set(new Map());
    } finally {
      this.loading.set(false);
    }
  }

  protected setKindFilter(kind: TKindFilter): void {
    this.kindFilter.set(kind);
  }

  protected isKindFilterActive(kind: TKindFilter): boolean {
    return this.kindFilter() === kind;
  }

  protected toggleExpanded(id: string): void {
    const next = new Set(this.collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsed.set(next);
  }

  /**
   * Whether the bundle row is currently expanded. `collapsed` is the
   * only state input: rows the user explicitly collapsed via the
   * chevron live there (persisted to localStorage); every other row
   * defaults to expanded.
   *
   * Earlier versions also consulted a `forcedExpand` set that
   * auto-expanded bundles with filter matches. That broke the
   * chevron — once a filter was active, clicking the chevron added
   * the row to `collapsed` but `forcedExpand` overrode the verdict
   * here, so the row stayed expanded and the click felt unresponsive.
   * User choice has to win for the chevron icon to match reality.
   * Trade-off: a filter no longer auto-expands a previously-collapsed
   * bundle to surface matches — the user clicks the chevron to see
   * them. Acceptable because the chevron now actually works.
   */
  protected isExpanded(id: string): boolean {
    return !this.collapsed().has(id);
  }

  /** Current pending value for a toggle key. Used by the template
   *  bindings to drive `[ngModel]` from the buffer instead of the
   *  stale `plugin.status` / `ext.enabled` fields the GET shipped. */
  protected pendingEnabled(id: string): boolean {
    return this.pendingState().get(id) ?? false;
  }

  /** True when the key's current pending value differs from the
   *  original snapshot. Drives the per-row dirty dot. */
  protected isDirty(id: string): boolean {
    return this.dirtyIds().has(id);
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

  /**
   * Footer-level mirror of `showStartsAsDisabledHint`: `true` when AT
   * LEAST one plugin in the list satisfies the per-row trigger (boot
   * snapshot reports `startsAsDisabled` AND pending state is enabled).
   * Drives the italic restart-recommendation rendered next to the
   * Discard / Apply buttons so the warning is visible even when the
   * affected row is scrolled off-screen.
   */
  protected readonly restartRecommended = computed<boolean>(() => {
    const pending = this.pendingState();
    for (const plugin of this.plugins()) {
      if (plugin.startsAsDisabled !== true) continue;
      if (pending.get(plugin.id) === true) return true;
    }
    return false;
  });

  protected onBundleToggle(plugin: IPluginItemApi, nextValue: boolean): void {
    if (this.applying()) return;
    const next = new Map(this.pendingState());
    next.set(plugin.id, nextValue);
    this.pendingState.set(next);
  }

  protected onExtensionToggle(
    bundleId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void {
    if (this.applying()) return;
    const key = qualifiedKey(bundleId, ext.id);
    const next = new Map(this.pendingState());
    next.set(key, nextValue);
    this.pendingState.set(next);
  }

  /**
   * Ship the dirty buffer as a single bulk PATCH. On success: refresh
   * `originalState` / `pendingState` from the response, clear the
   * dirty set, and trigger a scan so the graph reflects the new state.
   * Errors surface in `toggleError` and leave the buffer intact so
   * the user can retry or discard.
   */
  async applyChanges(): Promise<void> {
    if (this.applying()) return;
    const dirty = this.dirtyIds();
    if (dirty.size === 0) return;
    const changes: Array<{ id: string; enabled: boolean }> = [];
    const pending = this.pendingState();
    for (const id of dirty) {
      changes.push({ id, enabled: pending.get(id) ?? false });
    }
    this.applying.set(true);
    this.toggleError.set(null);
    let success = false;
    try {
      const envelope = await this.dataSource.applyPluginChanges(changes);
      this.plugins.set([...envelope.items]);
      const fresh = buildStateFromPlugins(envelope.items);
      this.originalState.set(fresh);
      this.pendingState.set(new Map(fresh));
      // Fire a scan so the graph picks up the new contribution set.
      // The trigger service guards against concurrent runs and owns
      // the topbar spinner — both surfaces stay consistent.
      void this.scanTrigger.run();
      success = true;
    } catch (err) {
      this.toggleError.set(formatErr(err));
    } finally {
      this.applying.set(false);
    }
    // Notify the modal host AFTER `applying` flips back so the close
    // animation doesn't race with a still-busy state. Only fires on
    // success — a failed apply keeps the modal open with the buffer
    // intact so the user can retry or discard.
    if (success) this.applied.emit();
  }

  /** Revert every pending edit to the snapshot from the last refresh.
   *  Does NOT touch the DB; the user can re-toggle freely afterwards. */
  discardChanges(): void {
    this.pendingState.set(new Map(this.originalState()));
    this.toggleError.set(null);
  }

  /**
   * Should the bundle's `<p-toggleswitch>` render at all? False for
   * load-failure rows (the spec has no enabled/disabled axis to flip)
   * and for granularity=extension bundles (the per-extension switches
   * downstairs do the toggling). Locked rows still render the switch
   * — disabled — so the user sees the current enabled state and a
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
   * Whether clicking anywhere on the row should do something useful —
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
   * already handled by their own listeners — those stop the event
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
    if (isFailureStatus(plugin.status)) {
      return SETTINGS_TEXTS.statusFailure[plugin.status] ?? plugin.status;
    }
    return plugin.status === 'enabled'
      ? SETTINGS_TEXTS.enabledLabel
      : SETTINGS_TEXTS.disabledLabel;
  }

  protected sourceLabel(source: IPluginItemApi['source']): string {
    switch (source) {
      case 'built-in':
        return SETTINGS_TEXTS.sourceBuiltIn;
      case 'project':
        return SETTINGS_TEXTS.sourceProject;
      case 'global':
        return SETTINGS_TEXTS.sourceGlobal;
    }
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
