import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { MapViewSwitcher } from '../map-view-switcher';
import type {
  IMapViewApi,
  IMapViewEntryApi,
  IMapViewsEnvelopeApi,
} from '../../../../../models/api';
import { CollectionLoaderService } from '../../../../../services/collection-loader';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../../services/data-source/data-source.port';
import {
  SKILL_MAP_MODE,
  type TSkillMapMode,
} from '../../../../../services/data-source/runtime-mode';
import { MapViewsService } from '../../../../../services/map-views';

/**
 * `<sm-map-view-switcher>`: demo hiding, the neutral / active trigger
 * label + dirty dot, and the popover's empty state and view list
 * (per-row testids + dead-ref badge). The popover renders at
 * `document.body` (appendTo="body"), so panel assertions query the
 * document; each test destroys its fixture so no panel leaks into the
 * next.
 */

const FOCUS_VIEW: IMapViewApi = {
  schemaVersion: 1,
  kind: 'map-view',
  name: 'Docs focus',
  overrides: [
    ['', 'exclude'],
    ['docs', 'include'],
  ],
  pins: { 'docs/a.md': { x: 10, y: 20 } },
};

interface ISetupOpts {
  entries?: IMapViewEntryApi[];
  mode?: TSkillMapMode;
  corpus?: string[];
}

let activeFixture: ComponentFixture<MapViewSwitcher> | null = null;

function setup(opts: ISetupOpts = {}) {
  localStorage.clear();
  const envelope: IMapViewsEnvelopeApi = {
    schemaVersion: '1',
    kind: 'map-views',
    views: opts.entries ?? [],
    skipped: [],
  };
  const getMapViews = vi.fn().mockResolvedValue(envelope);
  const stub = { getMapViews } as unknown as IDataSourcePort;
  const liteNodes = signal((opts.corpus ?? []).map((path) => ({ path })));

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [MapViewSwitcher],
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      { provide: SKILL_MAP_MODE, useValue: opts.mode ?? 'live' },
      { provide: CollectionLoaderService, useValue: { liteNodes } },
    ],
  });
  const fixture = TestBed.createComponent(MapViewSwitcher);
  activeFixture = fixture;
  fixture.detectChanges();
  const service = TestBed.inject(MapViewsService);
  return { fixture, service, getMapViews };
}

/** Click the trigger and settle the lazy load + popover render. */
async function openPopover(fixture: ComponentFixture<MapViewSwitcher>): Promise<void> {
  const trigger = fixture.nativeElement.querySelector(
    '[data-testid="map-view-switcher"] button',
  ) as HTMLButtonElement;
  trigger.click();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('MapViewSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    // Tear the popover portal (document.body) down with the fixture so
    // panel queries never leak across tests.
    activeFixture?.destroy();
    activeFixture = null;
  });

  it('hides entirely in demo mode', () => {
    const { fixture } = setup({ mode: 'demo' });
    expect(
      fixture.nativeElement.querySelector('[data-testid="map-view-switcher"]'),
    ).toBeNull();
  });

  it('renders the neutral trigger label while no view is active', () => {
    const { fixture } = setup();
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="map-view-switcher"]',
    ) as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain('Views');
    expect(
      fixture.nativeElement.querySelector('[data-testid="map-view-dirty"]'),
    ).toBeNull();
  });

  it('shows the empty state (save-as CTA present) when no views exist', async () => {
    const { fixture } = setup();
    await openPopover(fixture);
    expect(document.body.querySelector('[data-testid="map-view-empty"]')).not.toBeNull();
    expect(
      document.body.querySelector('[data-testid="map-view-save-as"]'),
    ).not.toBeNull();
    // No active view: the exit affordance stays hidden.
    expect(document.body.querySelector('[data-testid="map-view-exit"]')).toBeNull();
  });

  it('lists views with per-slug testids and a dead-ref badge against the corpus', async () => {
    const { fixture } = setup({
      entries: [{ slug: 'docs-focus', view: FOCUS_VIEW }],
      // `docs/a.md` resolves both the `docs` prefix override and the
      // pin, so the view carries zero broken refs.
      corpus: ['docs/a.md'],
    });
    await openPopover(fixture);
    const item = document.body.querySelector('[data-testid="map-view-item-docs-focus"]');
    expect(item).not.toBeNull();
    expect(item?.textContent).toContain('Docs focus');
    expect(
      document.body.querySelector('[data-testid="map-view-broken-docs-focus"]'),
    ).toBeNull();
    expect(
      document.body.querySelector('[data-testid="map-view-delete-docs-focus"]'),
    ).not.toBeNull();
  });

  it('surfaces the broken-ref count when references died', async () => {
    const { fixture } = setup({
      entries: [{ slug: 'docs-focus', view: FOCUS_VIEW }],
      corpus: ['src/other.md'], // nothing under docs/ survives
    });
    await openPopover(fixture);
    const badge = document.body.querySelector(
      '[data-testid="map-view-broken-docs-focus"]',
    );
    // The `docs` override key and the `docs/a.md` pin are both dead.
    expect(badge?.textContent).toContain('2 broken refs');
  });

  it('shows the active view name and the dirty dot once the curation deviates', async () => {
    const { fixture, service } = setup({
      entries: [{ slug: 'docs-focus', view: FOCUS_VIEW }],
      corpus: ['docs/a.md'],
    });
    await service.loadViews();
    service.apply('docs-focus');
    // Simulate the graph effect consuming the pins (clean state).
    service.setLivePins(service.pendingPins() ?? {});
    service.clearPendingPins();
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="map-view-switcher"]',
    ) as HTMLElement;
    expect(trigger.textContent).toContain('Docs focus');
    expect(
      fixture.nativeElement.querySelector('[data-testid="map-view-dirty"]'),
    ).toBeNull();

    // Deviate: a moved pin flips the dirty dot on.
    service.setLivePins({ 'docs/a.md': { x: 99, y: 20 } });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="map-view-dirty"]'),
    ).not.toBeNull();
  });

  it('save disables while clean; exit shows for the active view', async () => {
    const { fixture, service } = setup({
      entries: [{ slug: 'docs-focus', view: FOCUS_VIEW }],
      corpus: ['docs/a.md'],
    });
    await service.loadViews();
    service.apply('docs-focus');
    service.setLivePins(service.pendingPins() ?? {});
    service.clearPendingPins();
    fixture.detectChanges();
    await openPopover(fixture);

    const saveBtn = document.body.querySelector(
      '[data-testid="map-view-save"] button',
    ) as HTMLButtonElement;
    expect(saveBtn?.disabled).toBe(true);
    expect(document.body.querySelector('[data-testid="map-view-exit"]')).not.toBeNull();
  });

  it('revert disables while clean, enables on divergence, and restores the saved state', async () => {
    const { fixture, service } = setup({
      entries: [{ slug: 'docs-focus', view: FOCUS_VIEW }],
      corpus: ['docs/a.md'],
    });
    await service.loadViews();
    service.apply('docs-focus');
    service.setLivePins(service.pendingPins() ?? {});
    service.clearPendingPins();
    fixture.detectChanges();
    await openPopover(fixture);

    const revertBtn = (): HTMLButtonElement =>
      document.body.querySelector('[data-testid="map-view-revert"] button') as HTMLButtonElement;
    expect(revertBtn()?.disabled).toBe(true);

    // Diverge a pin; the revert affordance arms.
    service.setLivePins({ 'docs/a.md': { x: 999, y: 999 } });
    fixture.detectChanges();
    expect(revertBtn()?.disabled).toBe(false);

    revertBtn().click();
    // Revert re-parks the SAVED pin set for the graph effect to consume.
    expect(service.pendingPins()).toEqual(FOCUS_VIEW.pins);
    service.setLivePins(service.pendingPins() ?? {});
    service.clearPendingPins();
    fixture.detectChanges();
    expect(service.dirty()).toBe(false);
    expect(revertBtn()?.disabled).toBe(true);
  });

  describe('digit shortcuts (implicit list order)', () => {
    const OTHER_VIEW: IMapViewApi = {
      schemaVersion: 1,
      kind: 'map-view',
      name: 'Other',
      overrides: [],
      pins: {},
    };

    function pressDigit(key: string, target?: HTMLElement): void {
      (target ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    }

    /** Emulate the graph effect consuming a parked pin set. */
    function settlePins(service: MapViewsService): void {
      service.setLivePins(service.pendingPins() ?? {});
      service.clearPendingPins();
    }

    it('keys 1 and 2 apply the first and second view of the list', async () => {
      const { fixture, service } = setup({
        entries: [
          { slug: 'docs-focus', view: FOCUS_VIEW },
          { slug: 'zz-other', view: OTHER_VIEW },
        ],
        corpus: ['docs/a.md'],
      });
      await fixture.whenStable(); // eager list load

      pressDigit('2');
      await fixture.whenStable();
      expect(service.activeSlug()).toBe('zz-other');
      settlePins(service);

      pressDigit('1');
      await fixture.whenStable();
      expect(service.activeSlug()).toBe('docs-focus');
    });

    it('a digit beyond the list length is a no-op', async () => {
      const { fixture, service } = setup({
        entries: [{ slug: 'docs-focus', view: FOCUS_VIEW }],
      });
      await fixture.whenStable();

      pressDigit('3');
      await fixture.whenStable();
      expect(service.activeSlug()).toBeNull();
    });

    it('digits typed into an editable surface never switch', async () => {
      const { fixture, service } = setup({
        entries: [{ slug: 'docs-focus', view: FOCUS_VIEW }],
      });
      await fixture.whenStable();

      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        pressDigit('1', input);
        await fixture.whenStable();
        expect(service.activeSlug()).toBeNull();
      } finally {
        input.remove();
      }
    });

    it('digits are inert while the dirty-switch dialog is pending', async () => {
      const { fixture, service } = setup({
        entries: [
          { slug: 'docs-focus', view: FOCUS_VIEW },
          { slug: 'zz-other', view: OTHER_VIEW },
        ],
        corpus: ['docs/a.md'],
      });
      await fixture.whenStable();

      pressDigit('1');
      await fixture.whenStable();
      settlePins(service);
      // Diverge, then ask for the second view: the dirty gate parks the
      // intent (the stub has no preferences endpoint, so asking is the
      // default) instead of switching.
      service.setLivePins({ 'docs/a.md': { x: 777, y: 777 } });
      pressDigit('2');
      await fixture.whenStable();
      expect(service.pendingSwitch()).not.toBeNull();
      expect(service.activeSlug()).toBe('docs-focus');

      // Another digit while the dialog decision is pending: ignored.
      pressDigit('2');
      await fixture.whenStable();
      expect(service.activeSlug()).toBe('docs-focus');
      expect(service.pendingSwitch()).not.toBeNull();
    });
  });
});
