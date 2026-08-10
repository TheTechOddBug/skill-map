import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type {
  IMapViewApi,
  IMapViewEntryApi,
  IMapViewsEnvelopeApi,
} from '../../models/api';
import { DATA_SOURCE, DataSourceError, type IDataSourcePort } from '../data-source/data-source.port';
import { SKILL_MAP_MODE, type TSkillMapMode } from '../data-source/runtime-mode';
import { MapVisibilityService } from '../map-visibility';
import { MapViewsService } from '../map-views';

/**
 * `MapViewsService`: list loading, verbatim (order-preserving) apply,
 * exit, explicit save (active + save-as slug derivation, description /
 * groups round-trip), the dirty computation, the guarded switch
 * (dialog / suppressed / save-then-switch / cancel), and the
 * delete-active exit. DATA_SOURCE is a stub that emulates the BFF's
 * upsert + refreshed-envelope contract; MapVisibilityService is REAL
 * so the override interplay is exercised end to end.
 */

const FOCUS_VIEW: IMapViewApi = {
  schemaVersion: 1,
  kind: 'map-view',
  name: 'Focus',
  description: 'Working set for the docs sprint',
  // Order is load-bearing: the exclude-root + include pair must apply
  // and save back VERBATIM.
  overrides: [
    ['', 'exclude'],
    ['docs', 'include'],
  ],
  pins: { 'docs/a.md': { x: 10, y: 20 } },
  groups: [{ id: 'g1', label: 'Docs', members: ['docs/a.md'] }],
};

const OTHER_VIEW: IMapViewApi = {
  schemaVersion: 1,
  kind: 'map-view',
  name: 'Other',
  overrides: [['src', 'exclude']],
  pins: {},
};

interface IStubOpts {
  entries?: IMapViewEntryApi[];
  skipped?: string[];
  confirmViewSwitch?: boolean;
  mode?: TSkillMapMode;
  /** Session-restore case: do NOT wipe localStorage before building. */
  keepStorage?: boolean;
}

interface IHarness {
  service: MapViewsService;
  mapVisibility: MapVisibilityService;
  store: Map<string, IMapViewApi>;
  getMapViews: ReturnType<typeof vi.fn>;
  putMapView: ReturnType<typeof vi.fn>;
  deleteMapView: ReturnType<typeof vi.fn>;
  getProjectPreferences: ReturnType<typeof vi.fn>;
  setProjectPreferences: ReturnType<typeof vi.fn>;
}

function bootstrap(opts: IStubOpts = {}): IHarness {
  if (opts.keepStorage !== true) localStorage.clear();
  const store = new Map<string, IMapViewApi>(
    (opts.entries ?? [{ slug: 'focus', view: FOCUS_VIEW }]).map((e) => [e.slug, e.view]),
  );
  const skipped = opts.skipped ?? [];

  function envelope(): IMapViewsEnvelopeApi {
    return {
      schemaVersion: '1',
      kind: 'map-views',
      views: [...store.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([slug, view]) => ({ slug, view })),
      skipped,
    };
  }

  const getMapViews = vi.fn().mockImplementation(() => Promise.resolve(envelope()));
  const putMapView = vi.fn().mockImplementation((slug: string, view: IMapViewApi) => {
    store.set(slug, view);
    return Promise.resolve(envelope());
  });
  const deleteMapView = vi.fn().mockImplementation((slug: string) => {
    if (!store.has(slug)) {
      return Promise.reject(new DataSourceError('not-found', `no view ${slug}`));
    }
    store.delete(slug);
    return Promise.resolve(envelope());
  });
  const getProjectPreferences = vi.fn().mockResolvedValue({
    ui: { confirmViewSwitch: opts.confirmViewSwitch ?? true },
  });
  const setProjectPreferences = vi.fn().mockResolvedValue({});

  const stub = {
    getMapViews,
    putMapView,
    deleteMapView,
    getProjectPreferences,
    setProjectPreferences,
  } as unknown as IDataSourcePort;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      { provide: SKILL_MAP_MODE, useValue: opts.mode ?? 'live' },
    ],
  });
  return {
    service: TestBed.inject(MapViewsService),
    mapVisibility: TestBed.inject(MapVisibilityService),
    store,
    getMapViews,
    putMapView,
    deleteMapView,
    getProjectPreferences,
    setProjectPreferences,
  };
}

/** Simulate the graph view's projection after an apply consumed pins. */
function syncGraphPins(service: MapViewsService): void {
  const pending = service.pendingPins();
  if (pending !== null) {
    service.setLivePins(pending);
    service.clearPendingPins();
  }
}

describe('MapViewsService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadViews populates views + skipped lazily and dedupes the reload', async () => {
    const { service, getMapViews } = bootstrap({ skipped: ['broken.json'] });
    expect(service.loaded()).toBe(false);
    await service.loadViews();
    expect(service.views().map((v) => v.slug)).toEqual(['focus']);
    expect(service.skipped()).toEqual(['broken.json']);
    await service.loadViews();
    expect(getMapViews).toHaveBeenCalledTimes(1);
    await service.loadViews(true);
    expect(getMapViews).toHaveBeenCalledTimes(2);
  });

  it('a failed load surfaces error and leaves the list empty', async () => {
    const { service, getMapViews } = bootstrap();
    getMapViews.mockRejectedValueOnce(new DataSourceError('internal', 'boom'));
    await service.loadViews();
    expect(service.error()).toBe('boom');
    expect(service.views()).toEqual([]);
    expect(service.loaded()).toBe(false);
  });

  it('apply replaces the overrides VERBATIM (order preserved), parks pins, activates', async () => {
    const { service, mapVisibility } = bootstrap();
    await service.loadViews();
    service.apply('focus');
    expect([...mapVisibility.overrides()]).toEqual([
      ['', 'exclude'],
      ['docs', 'include'],
    ]);
    expect(service.pendingPins()).toEqual({ 'docs/a.md': { x: 10, y: 20 } });
    expect(service.activeSlug()).toBe('focus');
  });

  it('applying an unknown slug is a silent no-op (deep-link contract)', async () => {
    const { service, mapVisibility } = bootstrap();
    await service.loadViews();
    service.apply('nope');
    expect(service.activeSlug()).toBeNull();
    expect(mapVisibility.overrides().size).toBe(0);
    expect(service.pendingPins()).toBeNull();
  });

  it('exitViews clears curation, empties the pending pin set, deactivates', async () => {
    const { service, mapVisibility } = bootstrap();
    await service.loadViews();
    service.apply('focus');
    syncGraphPins(service);
    service.exitViews();
    expect(mapVisibility.overrides().size).toBe(0);
    expect(service.pendingPins()).toEqual({});
    expect(service.activeSlug()).toBeNull();
    expect(service.dirty()).toBe(false);
  });

  it('dirty transitions on override and pin deviations', async () => {
    const { service, mapVisibility } = bootstrap();
    await service.loadViews();
    expect(service.dirty()).toBe(false); // neutral state, nothing to lose

    service.apply('focus');
    syncGraphPins(service);
    expect(service.dirty()).toBe(false);

    mapVisibility.setSubtree('src', 'include');
    expect(service.dirty()).toBe(true);
    service.apply('focus'); // re-apply = revert to saved
    syncGraphPins(service);
    expect(service.dirty()).toBe(false);

    service.setLivePins({ 'docs/a.md': { x: 99, y: 20 } });
    expect(service.dirty()).toBe(true);
  });

  it('revert restores the saved state of the active view (overrides + pins) and clears dirty', async () => {
    const { service, mapVisibility } = bootstrap();
    await service.loadViews();
    service.apply('focus');
    syncGraphPins(service);

    mapVisibility.setSubtree('src', 'include');
    service.setLivePins({ 'docs/a.md': { x: 99, y: 20 } });
    expect(service.dirty()).toBe(true);

    service.revert();
    syncGraphPins(service);
    expect(service.dirty()).toBe(false);
    expect(service.activeSlug()).toBe('focus');
    // The saved override map is back verbatim (the 'src' divergence gone).
    expect(mapVisibility.overrides().get('src')).toBeUndefined();
  });

  it('revert without an active view is a no-op', async () => {
    const { service, mapVisibility } = bootstrap();
    await service.loadViews();
    mapVisibility.setSubtree('src', 'exclude');
    const before = [...mapVisibility.overrides()];

    service.revert();
    expect([...mapVisibility.overrides()]).toEqual(before);
    expect(service.pendingPins()).toBeNull();
    expect(service.activeSlug()).toBeNull();
  });

  it('saveActive PUTs the live curation under the same slug, round-tripping description + groups', async () => {
    const { service, mapVisibility, putMapView } = bootstrap();
    await service.loadViews();
    service.apply('focus');
    syncGraphPins(service);

    mapVisibility.setSubtree('src', 'include');
    service.setLivePins({ 'docs/a.md': { x: 5, y: 6 } });
    expect(service.dirty()).toBe(true);

    await expect(service.saveActive()).resolves.toBe(true);
    expect(putMapView).toHaveBeenCalledTimes(1);
    const [slug, doc] = putMapView.mock.calls[0] as [string, IMapViewApi];
    expect(slug).toBe('focus');
    expect(doc).toEqual({
      schemaVersion: 1,
      kind: 'map-view',
      name: 'Focus',
      description: FOCUS_VIEW.description,
      overrides: [
        ['', 'exclude'],
        ['docs', 'include'],
        ['src', 'include'],
      ],
      pins: { 'docs/a.md': { x: 5, y: 6 } },
      groups: FOCUS_VIEW.groups,
    });
    // The refreshed envelope replaces the list, so the state is clean.
    expect(service.dirty()).toBe(false);
  });

  it('saveActive without an active view is a no-op failure', async () => {
    const { service, putMapView } = bootstrap();
    await service.loadViews();
    await expect(service.saveActive()).resolves.toBe(false);
    expect(putMapView).not.toHaveBeenCalled();
  });

  it('saveAs derives the slug, omits description/groups, and activates the new view', async () => {
    const { service, mapVisibility, putMapView } = bootstrap();
    await service.loadViews();
    mapVisibility.setSubtree('docs', 'include');
    service.setLivePins({ 'docs/a.md': { x: 1, y: 1 } });

    await expect(service.saveAs('  Visión Ñoña  ')).resolves.toBe(true);
    const [slug, doc] = putMapView.mock.calls[0] as [string, IMapViewApi];
    expect(slug).toBe('vision-nona');
    expect(doc.name).toBe('Visión Ñoña');
    expect(doc).not.toHaveProperty('description');
    expect(doc).not.toHaveProperty('groups');
    expect(service.activeSlug()).toBe('vision-nona');
    expect(service.dirty()).toBe(false);
  });

  it('saveAs rejects an unsluggable name without a write', async () => {
    const { service, putMapView } = bootstrap();
    await service.loadViews();
    await expect(service.saveAs('***')).resolves.toBe(false);
    expect(putMapView).not.toHaveBeenCalled();
  });

  it('deleting the active view exits views; deleting another does not', async () => {
    const { service, mapVisibility } = bootstrap({
      entries: [
        { slug: 'focus', view: FOCUS_VIEW },
        { slug: 'other', view: OTHER_VIEW },
      ],
    });
    await service.loadViews();
    service.apply('focus');
    syncGraphPins(service);

    await expect(service.deleteView('other')).resolves.toBe(true);
    expect(service.activeSlug()).toBe('focus');
    expect(mapVisibility.overrides().size).toBeGreaterThan(0);

    await expect(service.deleteView('focus')).resolves.toBe(true);
    expect(service.activeSlug()).toBeNull();
    expect(mapVisibility.overrides().size).toBe(0);
    expect(service.views()).toEqual([]);
  });

  it('an active slug missing from a refreshed list clears quietly, keeping curation', async () => {
    const { service, mapVisibility, store } = bootstrap();
    await service.loadViews();
    service.apply('focus');
    syncGraphPins(service);
    // A teammate deleted the file; the next refresh drops the entry.
    store.delete('focus');
    await service.loadViews(true);
    expect(service.activeSlug()).toBeNull();
    expect([...mapVisibility.overrides()]).toEqual([
      ['', 'exclude'],
      ['docs', 'include'],
    ]);
  });

  describe('guarded switch', () => {
    it('proceeds directly when not dirty, without fetching the preference', async () => {
      const { service, getProjectPreferences } = bootstrap();
      await service.loadViews();
      await expect(service.requestApply('focus')).resolves.toBe('done');
      expect(service.activeSlug()).toBe('focus');
      expect(service.pendingSwitch()).toBeNull();
      expect(getProjectPreferences).not.toHaveBeenCalled();
    });

    it('opens the dialog when dirty and the preference asks', async () => {
      const { service, mapVisibility } = bootstrap({
        entries: [
          { slug: 'focus', view: FOCUS_VIEW },
          { slug: 'other', view: OTHER_VIEW },
        ],
      });
      await service.loadViews();
      service.apply('focus');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');

      await expect(service.requestApply('other')).resolves.toBe('dialog');
      expect(service.pendingSwitch()).toEqual({ kind: 'apply', slug: 'other' });
      // Nothing switched yet.
      expect(service.activeSlug()).toBe('focus');
    });

    it('auto-proceeds when ui.confirmViewSwitch is false', async () => {
      const { service, mapVisibility } = bootstrap({
        confirmViewSwitch: false,
        entries: [
          { slug: 'focus', view: FOCUS_VIEW },
          { slug: 'other', view: OTHER_VIEW },
        ],
      });
      await service.loadViews();
      service.apply('focus');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');

      await expect(service.requestApply('other')).resolves.toBe('done');
      expect(service.activeSlug()).toBe('other');
      expect(service.pendingSwitch()).toBeNull();
    });

    it('a preference fetch failure defaults to asking', async () => {
      const { service, mapVisibility, getProjectPreferences } = bootstrap();
      getProjectPreferences.mockRejectedValueOnce(new Error('offline'));
      await service.loadViews();
      service.apply('focus');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');
      await expect(service.requestExit()).resolves.toBe('dialog');
    });

    it('cancel keeps everything; discard switches without saving', async () => {
      const { service, mapVisibility, putMapView } = bootstrap();
      await service.loadViews();
      service.apply('focus');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');

      await service.requestExit();
      await service.resolveSwitch({ action: 'cancel' });
      expect(service.activeSlug()).toBe('focus');
      expect(service.pendingSwitch()).toBeNull();

      await service.requestExit();
      await service.resolveSwitch({ action: 'discard' });
      expect(service.activeSlug()).toBeNull();
      expect(mapVisibility.overrides().size).toBe(0);
      expect(putMapView).not.toHaveBeenCalled();
    });

    it('save resolves save-then-switch; a failed save aborts the switch', async () => {
      const { service, mapVisibility, putMapView } = bootstrap({
        entries: [
          { slug: 'focus', view: FOCUS_VIEW },
          { slug: 'other', view: OTHER_VIEW },
        ],
      });
      await service.loadViews();
      service.apply('focus');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');

      putMapView.mockRejectedValueOnce(new DataSourceError('internal', 'disk full'));
      await service.requestApply('other');
      await service.resolveSwitch({ action: 'save' });
      // The save failed: no switch happened, nothing was discarded.
      expect(service.activeSlug()).toBe('focus');
      expect(service.error()).toBe('disk full');

      mapVisibility.setSubtree('src', 'include');
      await service.requestApply('other');
      await service.resolveSwitch({ action: 'save' });
      expect(putMapView).toHaveBeenCalledTimes(2);
      expect(service.activeSlug()).toBe('other');
    });

    it('always persists the suppression and skips the dialog from then on', async () => {
      const { service, mapVisibility, setProjectPreferences } = bootstrap({
        entries: [
          { slug: 'focus', view: FOCUS_VIEW },
          { slug: 'other', view: OTHER_VIEW },
        ],
      });
      await service.loadViews();
      service.apply('focus');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');

      await service.requestApply('other');
      await service.resolveSwitch({ action: 'discard', always: true });
      expect(setProjectPreferences).toHaveBeenCalledWith({
        ui: { confirmViewSwitch: false },
      });
      expect(service.activeSlug()).toBe('other');

      // Dirty again (dropping the saved src-exclude deviates from the
      // saved doc): the cached suppression skips the dialog.
      service.apply('other');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');
      expect(service.dirty()).toBe(true);
      await expect(service.requestApply('focus')).resolves.toBe('done');
    });

    it('a second resolution of the same intent is a no-op (structural dedupe)', async () => {
      const { service, mapVisibility } = bootstrap();
      await service.loadViews();
      service.apply('focus');
      syncGraphPins(service);
      mapVisibility.setSubtree('src', 'include');

      await service.requestExit();
      await service.resolveSwitch({ action: 'cancel' });
      // The close-driven visibleChange fires a late second cancel; and
      // even a late "discard" must find no intent to act on.
      await service.resolveSwitch({ action: 'discard' });
      expect(service.activeSlug()).toBe('focus');
    });
  });

  it('persists the active slug and restores it on the next session WITHOUT re-applying', async () => {
    const first = bootstrap();
    await first.service.loadViews();
    first.service.apply('focus');
    TestBed.tick(); // flush the persistence effect
    expect(localStorage.getItem('sm.map.active-view')).toBe('focus');

    // New "session" over the same localStorage (keepStorage): the slug
    // restores from storage at construction, and the service does NOT
    // apply the view on boot, so a dirty local curation persisted by
    // MapVisibilityService's own storage survives the reload as-is.
    const second = bootstrap({ keepStorage: true });
    expect(second.service.activeSlug()).toBe('focus');
    expect(second.service.pendingPins()).toBeNull();
  });

  it('demo mode reports unavailable', () => {
    const { service } = bootstrap({ mode: 'demo' });
    expect(service.available()).toBe(false);
  });
});
