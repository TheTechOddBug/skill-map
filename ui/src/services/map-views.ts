/**
 * `MapViewsService`, the owner of the map-views feature
 * (`spec/map-views.md`): named, committed projections of the workspace
 * map (`.skill-map/views/<slug>.json`), each capturing the visibility
 * overrides plus the manually pinned node positions.
 *
 * Placement: `ui/src/services/` (domain layer). Deps are `DATA_SOURCE`
 * and `MapVisibilityService` ONLY; the graph view integrates through
 * two signals instead of an import in either direction:
 *
 *   - `pendingPins` (service -> graph): `apply()` parks the view's pin
 *     set here; the graph view's effect consumes it (demotes every
 *     current position to auto, pins the view's entries as manual) and
 *     calls `clearPendingPins()`.
 *   - `livePins` (graph -> service): the graph view projects the
 *     `manual: true` subset of its `nodePositions` here, which feeds
 *     the `dirty` computation and the documents `saveActive` /
 *     `saveAs` build.
 *
 * Two UI states only: "no view" (neutral) and "view active". Saves are
 * EXPLICIT; the guarded entry points (`requestApply` / `requestExit`)
 * gate a dirty switch behind the Save / Discard / Cancel dialog,
 * suppressible via the project preference `ui.confirmViewSwitch`
 * (fetched once, cached; a fetch failure defaults to true, asking is
 * the safe default; mirror of `ProjectIgnoreService`).
 *
 * The active selection is per-developer (`sm.map.active-view` in
 * localStorage, plus the `?view=` deep link owned by
 * `MapViewUrlSyncService`); it never travels in the view file. On boot
 * the stored slug is restored WITHOUT re-applying the view, so unsaved
 * curation (already persisted by `MapVisibilityService` and the graph's
 * position storage) survives a reload as the dirty state it was.
 *
 * Dead references are legal: `apply()` sets the override map verbatim
 * (an override key that matches nothing simply matches nothing) and the
 * switcher surfaces the count via `brokenRefCount`. Demo mode
 * (`SKILL_MAP_MODE === 'demo'`) reports `available() === false` and the
 * feature hides entirely.
 */

import { Injectable, computed, effect, inject, signal } from '@angular/core';

import type {
  IMapViewApi,
  IMapViewEntryApi,
  IMapViewPointApi,
  IMapViewsEnvelopeApi,
} from '../models/api';
import { DATA_SOURCE, DataSourceError } from './data-source/data-source.port';
import { SKILL_MAP_MODE } from './data-source/runtime-mode';
import { MapVisibilityService } from './map-visibility';
import { overrideMapsEqual, type TVisibilityOverride } from './map-overrides';
import { pinsEqual, slugify } from './map-views.model';
import { readStoredActiveView, writeStoredActiveView } from './map-views.storage';

/** Pin set shape exchanged with the graph view. */
export type TMapViewPins = Readonly<Record<string, IMapViewPointApi>>;

/** What a guarded switch wants to do once confirmed. */
export type TPendingViewSwitch =
  | { kind: 'apply'; slug: string }
  | { kind: 'exit' };

/** The switch dialog's answer. */
export interface IMapViewSwitchDecision {
  action: 'save' | 'discard' | 'cancel';
  /** True when don't-ask-again was ticked; persists `ui.confirmViewSwitch: false`. */
  always?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MapViewsService {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly mapVisibility = inject(MapVisibilityService);
  private readonly mode = inject(SKILL_MAP_MODE);

  /** False in demo mode: the feature hides entirely (read-only bundle). */
  readonly available = computed(() => this.mode !== 'demo');

  private readonly _views = signal<readonly IMapViewEntryApi[]>([]);
  /** Every readable view, sorted by slug server-side. */
  readonly views = this._views.asReadonly();

  private readonly _skipped = signal<readonly string[]>([]);
  /** Basenames of view files the server skipped as unparseable. */
  readonly skipped = this._skipped.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _error = signal<string | null>(null);
  /** Last load / write failure, surfaced in the switcher popover. */
  readonly error = this._error.asReadonly();

  private readonly _loaded = signal(false);
  /** True once a views list (possibly empty) has landed. */
  readonly loaded = this._loaded.asReadonly();

  private readonly _activeSlug = signal<string | null>(readStoredActiveView());
  /** The active view's slug; `null` is the neutral "no view" state. */
  readonly activeSlug = this._activeSlug.asReadonly();

  /** The active view's list entry, `null` until the list carries it. */
  readonly activeView = computed<IMapViewEntryApi | null>(() => {
    const slug = this._activeSlug();
    if (slug === null) return null;
    return this._views().find((entry) => entry.slug === slug) ?? null;
  });

  private readonly _pendingPins = signal<TMapViewPins | null>(null);
  /**
   * Pin set waiting for the graph view to consume (see the class doc).
   * Non-null right after `apply()` / `exitViews()`; the graph effect
   * resets it via `clearPendingPins()` once positions are rewritten.
   */
  readonly pendingPins = this._pendingPins.asReadonly();

  private readonly _livePins = signal<TMapViewPins>({});
  /** The graph's current manual pin set (projected by the graph view). */
  readonly livePins = this._livePins.asReadonly();

  private readonly _pendingSwitch = signal<TPendingViewSwitch | null>(null);
  /** Drives the Save / Discard / Cancel dialog; `null` while closed. */
  readonly pendingSwitch = this._pendingSwitch.asReadonly();

  private readonly _openSwitcherTick = signal(0);
  /**
   * Open-the-switcher intent (files-rail chip -> graph toolbar
   * switcher). A monotonic tick instead of a boolean so every click
   * re-fires even when the popover was closed by other means.
   */
  readonly openSwitcherTick = this._openSwitcherTick.asReadonly();

  /**
   * The live curation deviates from the active view's saved state.
   * Overrides compare by value (`overrideMapsEqual`); pins compare by
   * value too (`pinsEqual`). No active view = never dirty (the neutral
   * state has nothing to lose).
   */
  readonly dirty = computed(() => {
    const entry = this.activeView();
    if (entry === null) return false;
    const saved = new Map<string, TVisibilityOverride>(entry.view.overrides);
    if (!overrideMapsEqual(this.mapVisibility.overrides(), saved)) return true;
    return !pinsEqual(this._livePins(), entry.view.pins);
  });

  /**
   * Cached `ui.confirmViewSwitch`; `null` until the first guarded
   * gesture fetches it. A fetch failure defaults to `true`: asking is
   * the safe default.
   */
  private readonly confirmPref = signal<boolean | null>(null);

  /** In-flight `loadViews` dedupe so boot + popover-open share one fetch. */
  private loadPromise: Promise<void> | null = null;

  constructor() {
    effect(() => writeStoredActiveView(this._activeSlug()));
  }

  /**
   * Lazy list fetch. Refreshes on `force`; every write path refreshes
   * from its own response envelope instead of calling this again.
   */
  async loadViews(force = false): Promise<void> {
    if (this._loaded() && !force) return;
    if (this.loadPromise !== null) return await this.loadPromise;
    this.loadPromise = this.performLoad();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async performLoad(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      this.ingest(await this.dataSource.getMapViews());
    } catch (err) {
      this._error.set(formatMapViewsError(err));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Fold a fresh envelope in (list fetch or write response). An active
   * slug that no longer resolves (view deleted server-side, or a stale
   * localStorage entry) clears QUIETLY to neutral; the live curation is
   * left untouched, nothing of the user's is lost.
   */
  private ingest(envelope: IMapViewsEnvelopeApi): void {
    this._views.set(envelope.views);
    this._skipped.set(envelope.skipped);
    this._loaded.set(true);
    const active = this._activeSlug();
    if (active !== null && !envelope.views.some((entry) => entry.slug === active)) {
      this._activeSlug.set(null);
    }
  }

  /**
   * Apply a view: overrides replace the live override map VERBATIM
   * (dead keys included, they simply match nothing), the pin set parks
   * in `pendingPins` for the graph effect, and the slug becomes active.
   * Unknown slug is a no-op (the deep-link contract: ignore, no error).
   */
  apply(slug: string): void {
    const entry = this._views().find((e) => e.slug === slug);
    if (entry === undefined) return;
    this.mapVisibility.setOverrides(
      new Map<string, TVisibilityOverride>(entry.view.overrides),
    );
    this._pendingPins.set({ ...entry.view.pins });
    this._activeSlug.set(slug);
  }

  /**
   * Revert the active view: discard the unsaved divergence and restore
   * the saved state, which is exactly a verbatim re-apply of the active
   * document (overrides and pins come back from the file, `dirty`
   * clears by construction). Deliberately unguarded: revert IS the
   * discard action, asking "discard?" on it would be noise. No-op
   * without an active view.
   */
  revert(): void {
    const active = this._activeSlug();
    if (active !== null) this.apply(active);
  }

  /**
   * Exit views: back to the neutral full map. Clears the curation and
   * demotes every manual pin (empty pending set = nothing stays pinned).
   */
  exitViews(): void {
    this.mapVisibility.clear();
    this._pendingPins.set({});
    this._activeSlug.set(null);
  }

  /** The graph effect consumed `pendingPins`; reset the mailbox. */
  clearPendingPins(): void {
    this._pendingPins.set(null);
  }

  /** Graph -> service projection of the manual pin subset. */
  setLivePins(pins: TMapViewPins): void {
    if (pinsEqual(pins, this._livePins())) return;
    this._livePins.set({ ...pins });
  }

  /**
   * Explicit save of the active view: current overrides + live manual
   * pins under the SAME slug and name, preserving the previously loaded
   * `description` and `groups` verbatim (wave-1 round-trip contract).
   * Returns success so the guarded switch can abort on failure.
   */
  async saveActive(): Promise<boolean> {
    const entry = this.activeView();
    if (entry === null) return false;
    return await this.putView(entry.slug, this.buildDocument(entry.view.name, entry.view));
  }

  /**
   * Save the live curation as a NEW view named `name` (slug derived
   * once via `slugify`; a collision overwrites, the switcher gates that
   * behind its explicit second-confirmation state). The new view
   * becomes active; the freshly saved state is clean by construction.
   */
  async saveAs(name: string): Promise<boolean> {
    const trimmed = name.trim();
    const slug = slugify(trimmed);
    if (trimmed.length === 0 || slug.length === 0) return false;
    const ok = await this.putView(slug, this.buildDocument(trimmed));
    if (ok) this._activeSlug.set(slug);
    return ok;
  }

  /** Delete a view; deleting the ACTIVE view also exits views. */
  async deleteView(slug: string): Promise<boolean> {
    this._error.set(null);
    const wasActive = this._activeSlug() === slug;
    try {
      this.ingest(await this.dataSource.deleteMapView(slug));
    } catch (err) {
      this._error.set(formatMapViewsError(err));
      return false;
    }
    if (wasActive) this.exitViews();
    return true;
  }

  /**
   * Guarded apply. `'done'` when the switch happened (no active view,
   * not dirty, or confirmation suppressed); `'dialog'` when the Save /
   * Discard / Cancel dialog took over (resolution flows through
   * `resolveSwitch`).
   */
  async requestApply(slug: string): Promise<'done' | 'dialog'> {
    if (await this.shouldConfirm()) {
      this._pendingSwitch.set({ kind: 'apply', slug });
      return 'dialog';
    }
    this.apply(slug);
    return 'done';
  }

  /** Guarded exit, same contract as `requestApply`. */
  async requestExit(): Promise<'done' | 'dialog'> {
    if (await this.shouldConfirm()) {
      this._pendingSwitch.set({ kind: 'exit' });
      return 'dialog';
    }
    this.exitViews();
    return 'done';
  }

  /**
   * The dialog's answer. Save-then-switch aborts when the save fails
   * (the error surfaces, nothing of the user's is discarded); a decline
   * double-fire (button + close-driven `visibleChange`) dedupes
   * structurally on the consumed intent.
   */
  async resolveSwitch(decision: IMapViewSwitchDecision): Promise<void> {
    const intent = this._pendingSwitch();
    if (intent === null) return;
    this._pendingSwitch.set(null);
    if (decision.action === 'cancel') return;
    if (decision.always === true) {
      this.confirmPref.set(false);
      // Fire-and-forget: a failed suppression persist only means the
      // dialog asks again next session, benign (same posture as
      // ProjectIgnoreService).
      void this.dataSource
        .setProjectPreferences({ ui: { confirmViewSwitch: false } })
        .catch(() => {});
    }
    if (decision.action === 'save') {
      const saved = await this.saveActive();
      if (!saved) return;
    }
    if (intent.kind === 'apply') this.apply(intent.slug);
    else this.exitViews();
  }

  /** Files-rail chip -> switcher popover intent (see `openSwitcherTick`). */
  requestOpenSwitcher(): void {
    this._openSwitcherTick.update((n) => n + 1);
  }

  /** Dirty + confirmation preference gate for the guarded entries. */
  private async shouldConfirm(): Promise<boolean> {
    if (!this.dirty()) return false;
    if (this.confirmPref() === null) {
      try {
        const prefs = await this.dataSource.getProjectPreferences();
        // `?? true` also tolerates an older BFF envelope without the key.
        this.confirmPref.set(prefs.ui?.confirmViewSwitch ?? true);
      } catch {
        this.confirmPref.set(true);
      }
    }
    return this.confirmPref() !== false;
  }

  /**
   * The document a save writes: current overrides in map insertion
   * order (the include seniority, preserved verbatim by the server) +
   * the live manual pins. `description` / `groups` ride along verbatim
   * when a prior document carries them.
   */
  private buildDocument(name: string, prior?: IMapViewApi): IMapViewApi {
    return {
      schemaVersion: 1,
      kind: 'map-view',
      name,
      ...(prior?.description !== undefined ? { description: prior.description } : {}),
      overrides: [...this.mapVisibility.overrides()],
      pins: { ...this._livePins() },
      ...(prior?.groups !== undefined ? { groups: prior.groups } : {}),
    };
  }

  private async putView(slug: string, view: IMapViewApi): Promise<boolean> {
    this._error.set(null);
    try {
      this.ingest(await this.dataSource.putMapView(slug, view));
      return true;
    } catch (err) {
      this._error.set(formatMapViewsError(err));
      return false;
    }
  }
}

/**
 * Local mirror of the settings-modal `formatErr` helper: the domain
 * layer must not import from `app/components`, and the three-branch
 * shape is too small to justify a shared module.
 */
function formatMapViewsError(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
