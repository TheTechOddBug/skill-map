/**
 * `<sm-settings-plugins>` — Plugins section of the Settings modal.
 *
 * Owns the full lifecycle: fetch on `(visible) === true`, render the
 * list with bundle / per-extension toggles, dispatch `setPluginEnabled`
 * / `setPluginExtensionEnabled` against the data-source port.
 *
 * Splitting this out of `SettingsModal` keeps the chassis (dialog +
 * sidebar) section-agnostic — adding `SettingsGeneral` / `SettingsAbout`
 * later is one new file and one entry in `SETTINGS_SECTIONS` rather
 * than a sprawling parent.
 *
 * Restart caveat: the BFF's plugin runtime is cached at boot. The
 * banner in this template is the same persistent `<p-message>` that
 * lived inline in the previous monolithic modal.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IListEnvelopeApi,
  IPluginExtensionApi,
  IPluginItemApi,
} from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { kindTint } from '../../../services/extension-kind-tints';

@Component({
  selector: 'sm-settings-plugins',
  imports: [FormsModule, IconFieldModule, InputIconModule, InputTextModule, MessageModule, ToggleSwitchModule],
  templateUrl: './settings-plugins.html',
  styleUrl: './settings-plugins.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPlugins {
  private readonly dataSource = inject(DATA_SOURCE);

  /**
   * Section visibility signal. The chassis flips it true when the
   * Plugins section becomes active AND the modal itself is visible;
   * we refresh the list on every transition to true so a flag toggled
   * via `sm plugins enable/disable` from another terminal surfaces on
   * the next view.
   */
  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly toggleError = signal<string | null>(null);
  protected readonly plugins = signal<IPluginItemApi[]>([]);
  protected readonly expanded = signal<Set<string>>(new Set());
  /** Pending toggle keys ('<id>' or '<bundle>/<ext>') — disable the
   *  switch so a double-click doesn't fire two PATCHes. */
  protected readonly pending = signal<Set<string>>(new Set());

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
  protected readonly filteredPlugins = computed(() => {
    const query = this.searchText().trim().toLowerCase();
    if (query.length === 0) return this.plugins();
    return this.plugins().flatMap((plugin) => filterBySearch(plugin, query));
  });
  /**
   * Bundles where the match was via an extension (id or description),
   * not via the bundle id / description. The template ORs this set with
   * the user-driven `expanded` set so search hits inside `core` show
   * up without an extra click.
   */
  protected readonly forcedExpand = computed<Set<string>>(() => {
    if (!this.searchActive()) return new Set();
    const query = this.searchText().trim().toLowerCase();
    const set = new Set<string>();
    for (const plugin of this.filteredPlugins()) {
      if (bundleHits(plugin, query)) continue;
      if (plugin.granularity !== 'extension') continue;
      if ((plugin.extensions?.length ?? 0) > 0) set.add(plugin.id);
    }
    return set;
  });

  constructor() {
    effect(() => {
      if (this.visible()) void this.refresh();
    });
  }

  /** Fetch (or re-fetch) the plugin list. Errors surface in `loadError`. */
  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.toggleError.set(null);
    try {
      const envelope = await this.dataSource.listPlugins();
      this.plugins.set([...envelope.items]);
    } catch (err) {
      this.loadError.set(formatErr(err));
      this.plugins.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggleExpanded(id: string): void {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded.set(next);
  }

  protected isExpanded(id: string): boolean {
    return this.expanded().has(id) || this.forcedExpand().has(id);
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  protected onBundleToggle(plugin: IPluginItemApi, nextValue: boolean): void {
    void this.runToggle(plugin.id, () =>
      this.dataSource.setPluginEnabled(plugin.id, nextValue),
    );
  }

  protected onExtensionToggle(
    bundleId: string,
    ext: IPluginExtensionApi,
    nextValue: boolean,
  ): void {
    const key = qualifiedKey(bundleId, ext.id);
    void this.runToggle(key, () =>
      this.dataSource.setPluginExtensionEnabled(bundleId, ext.id, nextValue),
    );
  }

  private async runToggle(
    key: string,
    op: () => Promise<IListEnvelopeApi<IPluginItemApi>>,
  ): Promise<void> {
    if (this.pending().has(key)) return;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.toggleError.set(null);
    try {
      const envelope = await op();
      this.plugins.set([...envelope.items]);
    } catch (err) {
      this.toggleError.set(formatErr(err));
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
  }

  protected canToggleBundle(plugin: IPluginItemApi): boolean {
    if (plugin.granularity === 'extension') return false;
    return !isFailureStatus(plugin.status);
  }

  /**
   * Whether clicking anywhere on the row should do something useful —
   * either toggle the bundle (when it has a toggle) or expand /
   * collapse the extension list (granularity=extension bundles).
   * Failure rows are inert: no toggle, nothing to expand.
   */
  protected rowIsClickable(plugin: IPluginItemApi): boolean {
    if (this.canToggleBundle(plugin)) return true;
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
  protected onRowClick(plugin: IPluginItemApi, event: MouseEvent): void {
    if (clickedInteractive(event)) return;
    if (this.canToggleBundle(plugin)) {
      this.onBundleToggle(plugin, plugin.status !== 'enabled');
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
    event: MouseEvent,
  ): void {
    if (clickedInteractive(event)) return;
    this.onExtensionToggle(bundleId, ext, !ext.enabled);
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

function qualifiedKey(bundleId: string, extensionId: string): string {
  return `${bundleId}/${extensionId}`;
}

/**
 * True when the user clicked on (or inside) an interactive child of
 * the row — the toggle, the expand chevron, or anything else with its
 * own click handler. Used by the row / subrow click listeners to back
 * off so we never double-fire (the inner control already did its job
 * and called `stopPropagation` where it mattered, but this guard is
 * defence in depth — `closest('label, button, [role=switch]')` covers
 * the PrimeNG ToggleSwitch root and the chevron button without us
 * having to hard-code a class list).
 */
function clickedInteractive(event: MouseEvent): boolean {
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  return target.closest('label, button, input, [role="switch"], p-toggleswitch') !== null;
}

/**
 * Match `plugin` against the lower-cased query. Returns `[plugin]` when
 * the bundle hits (id OR description; passes through with the original
 * extensions), `[plugin']` (with the extensions array narrowed to the
 * matching ones) when the bundle misses but one or more extensions hit,
 * or `[]` when nothing matches.
 *
 * Match axes (any of):
 *   - bundle.id includes query
 *   - bundle.description includes query
 *   - extension.id includes query (only for granularity=extension bundles)
 *   - extension.description includes query (same constraint)
 *
 * Lives outside the class so the `flatMap` in `filteredPlugins` reads
 * cleanly and the helper is unit-testable in isolation.
 */
function filterBySearch(plugin: IPluginItemApi, query: string): IPluginItemApi[] {
  if (bundleHits(plugin, query)) return [plugin];
  if (plugin.granularity !== 'extension' || !plugin.extensions) return [];
  const matchingExtensions = plugin.extensions.filter((ext) => extensionHits(ext, query));
  if (matchingExtensions.length === 0) return [];
  return [{ ...plugin, extensions: matchingExtensions }];
}

function bundleHits(plugin: IPluginItemApi, query: string): boolean {
  if (plugin.id.toLowerCase().includes(query)) return true;
  if (plugin.description && plugin.description.toLowerCase().includes(query)) return true;
  return false;
}

function extensionHits(ext: IPluginExtensionApi, query: string): boolean {
  if (ext.id.toLowerCase().includes(query)) return true;
  if (ext.description && ext.description.toLowerCase().includes(query)) return true;
  return false;
}

function isFailureStatus(status: IPluginItemApi['status']): boolean {
  return (
    status === 'incompatible-spec' ||
    status === 'invalid-manifest' ||
    status === 'load-error' ||
    status === 'id-collision'
  );
}

function formatErr(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
