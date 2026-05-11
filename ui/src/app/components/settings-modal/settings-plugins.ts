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
import { CollectionLoaderService } from '../../../services/collection-loader';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import {
  EXTENSION_KIND_TINTS,
  kindTint,
  type TExtensionKindForTint,
} from '../../../services/extension-kind-tints';

/** Sentinel for the "show every kind" segment of the kind filter. */
type TKindFilter = 'all' | TExtensionKindForTint;

/** Order matches the spec's `IExtensionBase.kind` enum and the marketing
 *  site's ecosystem diagram (provider → extractor → rule → action →
 *  formatter → hook). 'all' renders first as the neutral default. */
const KIND_FILTER_OPTIONS: readonly TKindFilter[] = [
  'all',
  ...(Object.keys(EXTENSION_KIND_TINTS) as TExtensionKindForTint[]),
] as const;

/**
 * localStorage keys for the small bits of UI state we want to outlive a
 * page reload. Same flavour as the `sm.graph.*` keys in `graph-view.ts`
 * — `sm.<surface>.<facet>` plain strings, JSON-encoded values, every
 * read defends against malformed payloads so a corrupted entry just
 * resets to the default rather than crashing the section.
 *
 * We intentionally do NOT persist `searchText`: a sticky search query
 * would surprise the user on reopen ("why is the list filtered?"), and
 * the BFF already paints the full list within the same modal session.
 */
const COLLAPSED_STORAGE_KEY = 'sm.settings.plugins.collapsed';
const KIND_FILTER_STORAGE_KEY = 'sm.settings.plugins.kind-filter';

@Component({
  selector: 'sm-settings-plugins',
  imports: [FormsModule, IconFieldModule, InputIconModule, InputTextModule, MessageModule, ToggleSwitchModule],
  templateUrl: './settings-plugins.html',
  styleUrl: './settings-plugins.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPlugins {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly collection = inject(CollectionLoaderService);

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
    this.plugins().flatMap(stripLocked),
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
  /**
   * Bundles where the visible row was narrowed by either filter — the
   * search hit only on extensions, OR the kind filter is active.
   * Forcing the expansion lets the user see the matching extensions
   * without an extra click. The template ORs this set with the
   * user-driven `expanded` set.
   */
  protected readonly forcedExpand = computed<Set<string>>(() => {
    if (!this.searchActive() && !this.kindFilterActive()) return new Set();
    const query = this.searchText().trim().toLowerCase();
    const searchActive = this.searchActive();
    const kindActive = this.kindFilterActive();
    const set = new Set<string>();
    for (const plugin of this.filteredPlugins()) {
      if (plugin.granularity !== 'extension') continue;
      if ((plugin.extensions?.length ?? 0) === 0) continue;
      if (kindActive) {
        set.add(plugin.id);
        continue;
      }
      if (searchActive && !bundleHits(plugin, query)) {
        set.add(plugin.id);
      }
    }
    return set;
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

  protected isExpanded(id: string): boolean {
    if (this.forcedExpand().has(id)) return true;
    return !this.collapsed().has(id);
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
      // The toggle response carries the new plugin list, but the cached
      // `node.contributions[]` on the in-memory node store is stale —
      // the BFF purged the DB rows for a disabled plugin (see
      // `src/server/routes/plugins.ts` → `persistAndProject`), so a
      // fresh `loadScan()` returns nodes without those contributions
      // and the card chips disappear. Fire-and-forget: the loader is
      // collapsing-aware (`pendingRefresh`) so back-to-back toggles
      // produce at most one extra round-trip.
      void this.collection.load();
    } catch (err) {
      this.toggleError.set(formatErr(err));
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
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
  protected onRowClick(plugin: IPluginItemApi, event: MouseEvent): void {
    if (clickedInteractive(event)) return;
    if (this.bundleToggleInteractive(plugin)) {
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
    if (!this.extensionToggleInteractive(ext)) return;
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

/**
 * Narrow `plugin` to the picked kind:
 *
 *   - **granularity=bundle**: keep the row when `plugin.kinds` includes
 *     the picked kind. Bundle rows don't expose an `extensions` array
 *     on the wire, so we match on the aggregated `kinds` field the
 *     BFF stamps from the underlying extension list. This is what
 *     keeps the three vendor provider bundles (`claude`, `gemini`,
 *     `agent-skills`) visible under the "Provider" filter.
 *   - **granularity=extension**: drop the bundle if none of its
 *     extensions match; otherwise keep the bundle with only the
 *     matching extensions.
 *
 * Returns `[]` when nothing matches so the caller can simply `flatMap`.
 */
function filterByKind(
  plugin: IPluginItemApi,
  kind: TExtensionKindForTint,
): IPluginItemApi[] {
  if (plugin.granularity === 'bundle') {
    return plugin.kinds.some((k) => k.toLowerCase() === kind) ? [plugin] : [];
  }
  if (!plugin.extensions) return [];
  const matchingExtensions = plugin.extensions.filter(
    (ext) => ext.kind.toLowerCase() === kind,
  );
  if (matchingExtensions.length === 0) return [];
  return [{ ...plugin, extensions: matchingExtensions }];
}

/**
 * Strip host-locked rows from the listing:
 *
 *   - bundle-level lock (`plugin.locked`) → drop the row entirely.
 *   - granularity=extension bundle: drop locked extensions; if the
 *     bundle ends up with zero extensions, drop the bundle row too
 *     (it has no toggle of its own and no children to show).
 *
 * Lives outside the class so `visiblePlugins`'s `flatMap` reads cleanly
 * and the helper is unit-testable in isolation.
 */
function stripLocked(plugin: IPluginItemApi): IPluginItemApi[] {
  if (plugin.locked) return [];
  if (plugin.granularity !== 'extension' || !plugin.extensions) {
    return [plugin];
  }
  const visibleExtensions = plugin.extensions.filter((ext) => !ext.locked);
  if (visibleExtensions.length === 0) return [];
  return [{ ...plugin, extensions: visibleExtensions }];
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

/* ------------------------------------------------------------------ */
/* localStorage helpers — same shape as `graph-view.ts`'s persistence */
/* (read defends against malformed payloads and missing storage; write */
/* swallows quota errors so a full disk never crashes the modal).      */
/* ------------------------------------------------------------------ */

function readStoredCollapsed(): Set<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
  } catch {
    return new Set();
  }
  if (!raw) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const out = new Set<string>();
  for (const id of parsed) {
    if (typeof id === 'string' && id.length > 0) out.add(id);
  }
  return out;
}

function writeStoredCollapsed(set: ReadonlySet<string>): void {
  try {
    if (set.size === 0) {
      localStorage.removeItem(COLLAPSED_STORAGE_KEY);
      return;
    }
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota exceeded or storage blocked — ignore.
  }
}

function readStoredKindFilter(): TKindFilter {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KIND_FILTER_STORAGE_KEY);
  } catch {
    return 'all';
  }
  if (!raw) return 'all';
  // Validate against the closed set so a stale entry from a prior
  // schema (e.g. a kind that was renamed) falls back to the safe
  // default rather than rendering as a phantom segment.
  return KIND_FILTER_OPTIONS.includes(raw as TKindFilter)
    ? (raw as TKindFilter)
    : 'all';
}

function writeStoredKindFilter(kind: TKindFilter): void {
  try {
    if (kind === 'all') {
      localStorage.removeItem(KIND_FILTER_STORAGE_KEY);
      return;
    }
    localStorage.setItem(KIND_FILTER_STORAGE_KEY, kind);
  } catch {
    // Quota exceeded or storage blocked — ignore.
  }
}
