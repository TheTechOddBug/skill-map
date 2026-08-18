import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

/**
 * The "files follows the map selection" reveal path.
 *
 * Written alongside the virtual-scroll migration, which rewrote it: the
 * reveal used to `querySelector` the row and call `scrollIntoView`, which
 * silently no-ops under virtualisation because an off-window row is simply
 * not in the DOM. It now resolves the row's INDEX and scrolls the viewport
 * arithmetically, reproducing `block: 'nearest'` semantics.
 *
 * Before this file the whole path had zero coverage, unit or e2e: every
 * other files-view spec boots with the follow preference off, so the reveal
 * effect returns early.
 *
 * Geometry comes from the scroller stubs in `src/test-setup.ts`
 * (800px viewport); rows are `FILES_ROW_HEIGHT_PX` tall.
 */
import { FILES_ROW_HEIGHT_PX, FilesView } from '../files-view';
import { settleVirtualScroll } from '../../../../testing/virtual-scroll';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilesFollowSelectionService } from '../../../../services/files-follow-selection';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { ProjectIgnoreService } from '../../../../services/project-ignore';
import { MapViewsService } from '../../../../services/map-views';
import { LiveLensService } from '../../../../services/live-lens';
import { MAP_ISOLATE_INTENT } from '../../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import type { INodeView } from '../../../../models/node';
import type { IFolderNodeLite, INodeActivityStatsApi } from '../../../../models/api';

const VIEWPORT_H = 800;

/** A corpus far larger than the render window, so "off-window" is real. */
function makeCorpus(leavesPerFolder = 30): INodeView[] {
  const out: INodeView[] = [];
  for (const folder of ['alpha', 'beta']) {
    for (let i = 0; i < leavesPerFolder; i += 1) {
      const name = `f${String(i).padStart(3, '0')}`;
      out.push({
        path: `${folder}/nested/${name}.md`,
        kind: 'agent',
        frontmatter: { name, description: '' },
      } as INodeView);
    }
  }
  return out;
}

async function boot(options: { follow: boolean; path?: string; reduceMotion?: boolean }) {
  const nodes = makeCorpus();
  const lite: IFolderNodeLite[] = nodes.map((n) => ({
    path: n.path,
    kind: n.kind,
    linksInCount: 0,
    linksOutCount: 0,
    tokensTotal: null,
    modifiedAtMs: null,
    errorCount: 0,
    warnCount: 0,
    sidecarStatus: null,
  }));
  const loader = {
    nodes: signal(nodes),
    liteNodes: signal(lite),
    liteNodeViews: signal<INodeView[]>(nodes),
    corpusCount: signal(nodes.length),
    loading: signal(false),
    error: signal<string | null>(null),
  };

  // The reveal reads `matchMedia` for the reduced-motion decision. `test-setup`
  // already installs a full `MediaQueryList` stub, so override only the value
  // this spec cares about and KEEP the rest of the shape: a `{ matches }`-only
  // replacement leaks a booby-trapped global into whichever specs Vitest
  // schedules later in the same worker (`ThemeService` passes the
  // `typeof matchMedia === 'function'` guard and then dies on
  // `mq.addEventListener`). That leak is what broke CI on 2026-08-03, on a file
  // that has nothing to do with this one.
  const baseMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query: string): MediaQueryList => {
    const mql = baseMatchMedia(query);
    Object.defineProperty(mql, 'matches', {
      configurable: true,
      value: !!options.reduceMotion && query.includes('reduce'),
    });
    return mql;
  };

  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CollectionLoaderService, useValue: loader },
      { provide: MAP_ISOLATE_INTENT, useValue: { isolate: () => undefined } },
      // Live lens owner: stubbed OFF so the rail keeps its whole-corpus
      // listing (the lens narrows it to the executed set) and construction
      // never reaches DATA_SOURCE / SKILL_MAP_MODE through its graph.
      {
        provide: LiveLensService,
        useValue: {
          active: signal(false).asReadonly(),
          membership: signal<ReadonlySet<string>>(new Set()).asReadonly(),
        } as unknown as LiveLensService,
      },
      { provide: NODE_OPEN_INTENT, useValue: { open: () => undefined } },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(options.path ? { path: options.path } : {})),
          snapshot: { queryParamMap: convertToParamMap(options.path ? { path: options.path } : {}) },
        },
      },
      {
        provide: NodeActivityStatsService,
        useValue: {
          stats: signal<ReadonlyMap<string, INodeActivityStatsApi>>(new Map()),
          pairCounts: signal<ReadonlyMap<string, number>>(new Map()),
        } as unknown as NodeActivityStatsService,
      },
      // FilesView injects the ignore-gesture owner (Ignore row buttons);
      // stub it so construction never reaches DATA_SOURCE / SKILL_MAP_MODE.
      {
        provide: ProjectIgnoreService,
        useValue: {
          available: signal(true).asReadonly(),
          errorText: signal<string | null>(null).asReadonly(),
          requestIgnore: () => Promise.resolve('dialog'),
          clearError: () => undefined,
        } as unknown as ProjectIgnoreService,
      },
      // Map-views owner: stubbed neutral (no active view) so the
      // provenance chip stays hidden and no DATA_SOURCE token is needed.
      {
        provide: MapViewsService,
        useValue: {
          available: signal(true).asReadonly(),
          activeView: signal(null).asReadonly(),
          dirty: signal(false).asReadonly(),
          requestOpenSwitcher: () => undefined,
        } as unknown as MapViewsService,
      },
    ],
  });
  // The preference defaults ON (2026-08-18): the off cases opt out by
  // toggling DOWN from the default instead of the old opt-in toggle.
  if (!options.follow) TestBed.inject(FilesFollowSelectionService).toggle();

  const fixture = TestBed.createComponent(FilesView);
  await settleVirtualScroll(fixture);
  // The reveal schedules its scroll in `afterNextRender`, one more macrotask.
  await settleVirtualScroll(fixture);
  return fixture;
}

function scroller(fixture: Awaited<ReturnType<typeof boot>>): HTMLElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    '[data-testid="files-scroller"]',
  );
  if (!el) throw new Error('missing files scroller');
  return el;
}

/** Index of a path in the component's current row list. */
function rowIndexOf(fixture: Awaited<ReturnType<typeof boot>>, path: string): number {
  const rows = (fixture.componentInstance as unknown as {
    rows: () => Array<{ path: string }>;
  }).rows();
  return rows.findIndex((r) => r.path === path);
}

describe('FilesView reveal (files follows the map selection)', () => {
  it('expands the ancestors of the selected leaf so it joins the row list', async () => {
    const target = 'beta/nested/f020.md';
    const fixture = await boot({ follow: true, path: target });

    // Without the ancestor expansion this row would not exist at all: the
    // tree boots collapsed.
    expect(rowIndexOf(fixture, target)).toBeGreaterThanOrEqual(0);
  });

  it('scrolls an off-window row to the nearest edge', async () => {
    const target = 'beta/nested/f020.md';
    const fixture = await boot({ follow: true, path: target });

    const index = rowIndexOf(fixture, target);
    expect(index).toBeGreaterThan(0);
    const rowBottom = (index + 1) * FILES_ROW_HEIGHT_PX;
    // Row is below the fold, so `nearest` aligns its BOTTOM with the
    // viewport bottom rather than parking it at the top.
    expect(scroller(fixture).scrollTop).toBe(Math.max(0, rowBottom - VIEWPORT_H));
  });

  it('does NOT move when the row is already fully visible', async () => {
    // The very first row is on screen at scrollTop 0, so a reveal that
    // ignored `nearest` semantics would still jump and be caught here.
    const fixture = await boot({ follow: true, path: 'alpha/nested/f000.md' });
    expect(scroller(fixture).scrollTop).toBe(0);
  });

  it('is inert while the follow preference is toggled off', async () => {
    const target = 'beta/nested/f020.md';
    const fixture = await boot({ follow: false, path: target });

    // Neither the ancestor expansion nor the scroll runs.
    expect(rowIndexOf(fixture, target)).toBe(-1);
    expect(scroller(fixture).scrollTop).toBe(0);
  });

  it('jumps instead of gliding under prefers-reduced-motion', async () => {
    const seen: ScrollBehavior[] = [];
    const original = Element.prototype.scrollTo;
    (Element.prototype as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo =
      function (this: Element, options: ScrollToOptions) {
        if (options?.behavior) seen.push(options.behavior);
        (this as unknown as { scrollTop: number }).scrollTop = options?.top ?? 0;
      };
    try {
      await boot({ follow: true, path: 'beta/nested/f020.md', reduceMotion: true });
      expect(seen).toContain('auto');
      expect(seen).not.toContain('smooth');
    } finally {
      Element.prototype.scrollTo = original;
    }
  });
});
