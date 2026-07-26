import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

/**
 * Keyboard navigation over the virtualised files rail.
 *
 * Virtualisation removed Tab as a way to walk the listing (only the render
 * window exists in the DOM, so Tab could never reach row 500). The rail
 * answers with a roving tabindex plus a delegated key handler; this spec
 * pins the key map, the roving invariant, and the focus rescue that keeps a
 * recycled row from stranding focus on `<body>` (WCAG 2.4.3).
 */
import { FilesView } from '../files-view';
import { settleVirtualScroll } from '../../../../testing/virtual-scroll';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { MapVisibilityService } from '../../../../services/map-visibility';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { MAP_ISOLATE_INTENT } from '../../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import type { INodeView } from '../../../../models/node';
import type { IFolderNodeLite, INodeActivityStatsApi } from '../../../../models/api';

function makeCorpus(): INodeView[] {
  const out: INodeView[] = [];
  for (const folder of ['alpha', 'beta']) {
    for (let i = 0; i < 10; i += 1) {
      const name = `f${String(i).padStart(2, '0')}`;
      out.push({
        path: `${folder}/${name}.md`,
        kind: 'agent',
        frontmatter: { name, description: '' },
      } as INodeView);
    }
  }
  return out;
}

async function boot() {
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
  const open = (path: string): void => {
    opened.push(path);
  };
  const opened: string[] = [];
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: CollectionLoaderService,
        useValue: {
          nodes: signal(nodes),
          liteNodes: signal(lite),
          liteNodeViews: signal<INodeView[]>(nodes),
          corpusCount: signal(nodes.length),
          loading: signal(false),
          error: signal<string | null>(null),
        },
      },
      { provide: MAP_ISOLATE_INTENT, useValue: { isolate: () => undefined } },
      { provide: NODE_OPEN_INTENT, useValue: { open } },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap({})),
          snapshot: { queryParamMap: convertToParamMap({}) },
        },
      },
      {
        provide: NodeActivityStatsService,
        useValue: {
          stats: signal<ReadonlyMap<string, INodeActivityStatsApi>>(new Map()),
          pairCounts: signal<ReadonlyMap<string, number>>(new Map()),
        } as unknown as NodeActivityStatsService,
      },
    ],
  });
  const selection = TestBed.inject(MapVisibilityService);
  const fixture = TestBed.createComponent(FilesView);
  await settleVirtualScroll(fixture);
  return { fixture, opened, selection };
}

type Booted = Awaited<ReturnType<typeof boot>>;

const host = (f: Booted['fixture']): HTMLElement => f.nativeElement as HTMLElement;

/** Press a key on the listing; the handler is delegated, so any row works. */
async function press(booted: Booted, key: string): Promise<void> {
  const row = host(booted.fixture).querySelector('tbody tr');
  row?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await settleVirtualScroll(booted.fixture);
}

const activeIndex = (booted: Booted): number =>
  (booted.fixture.componentInstance as unknown as { activeIndex: () => number }).activeIndex();

const rows = (booted: Booted): Array<{ path: string; type: string; expanded?: boolean }> =>
  (booted.fixture.componentInstance as unknown as {
    rows: () => Array<{ path: string; type: string; expanded?: boolean }>;
  }).rows();

describe('FilesView keyboard navigation', () => {
  it('exposes exactly one tabbable row at a time (roving tabindex)', async () => {
    const booted = await boot();
    const tabbable = host(booted.fixture).querySelectorAll('tbody tr[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
  });

  it('moves the active row with Arrow Down / Up', async () => {
    const booted = await boot();
    expect(activeIndex(booted)).toBe(0);

    await press(booted, 'ArrowDown');
    expect(activeIndex(booted)).toBe(1);

    await press(booted, 'ArrowUp');
    expect(activeIndex(booted)).toBe(0);
  });

  it('clamps at both ends instead of wrapping', async () => {
    const booted = await boot();
    await press(booted, 'ArrowUp');
    expect(activeIndex(booted)).toBe(0);

    await press(booted, 'End');
    const last = rows(booted).length - 1;
    expect(activeIndex(booted)).toBe(last);

    await press(booted, 'ArrowDown');
    expect(activeIndex(booted)).toBe(last);

    await press(booted, 'Home');
    expect(activeIndex(booted)).toBe(0);
  });

  it('Arrow Right expands a collapsed folder, Arrow Left collapses it', async () => {
    const booted = await boot();
    const before = rows(booted).length;
    expect(rows(booted)[0].type).toBe('folder');
    expect(rows(booted)[0].expanded).toBe(false);

    await press(booted, 'ArrowRight');
    expect(rows(booted)[0].expanded).toBe(true);
    expect(rows(booted).length).toBeGreaterThan(before);

    await press(booted, 'ArrowLeft');
    expect(rows(booted)[0].expanded).toBe(false);
    expect(rows(booted).length).toBe(before);
  });

  it('Arrow Left climbs to the enclosing folder from a leaf', async () => {
    const booted = await boot();
    await press(booted, 'ArrowRight'); // open the first folder
    await press(booted, 'ArrowDown'); // step onto its first child
    expect(activeIndex(booted)).toBe(1);

    await press(booted, 'ArrowLeft');
    expect(activeIndex(booted)).toBe(0);
  });

  it('Enter activates: it opens a leaf in the map and toggles a folder', async () => {
    const booted = await boot();

    await press(booted, 'Enter'); // on the first folder
    expect(rows(booted)[0].expanded).toBe(true);
    expect(booted.opened).toHaveLength(0);

    await press(booted, 'ArrowDown');
    await press(booted, 'Enter'); // now on a leaf
    expect(booted.opened).toEqual([rows(booted)[1].path]);
  });

  it('Space toggles map visibility rather than duplicating Enter', async () => {
    const booted = await boot();
    await press(booted, 'ArrowRight');
    await press(booted, 'ArrowDown');
    const leafPath = rows(booted)[1].path;

    await press(booted, ' ');
    expect(booted.selection.paths().has(leafPath)).toBe(true);
    // Activation is Enter's job; Space must not have opened anything.
    expect(booted.opened).toHaveLength(0);

    await press(booted, ' ');
    expect(booted.selection.paths().has(leafPath)).toBe(false);
  });

  it('keeps the active row addressable when the listing shrinks under it', async () => {
    const booted = await boot();
    await press(booted, 'End');
    const last = activeIndex(booted);
    expect(last).toBeGreaterThan(0);

    // Collapse everything: the row the focus pointed at no longer exists.
    (booted.fixture.componentInstance as unknown as { collapseAll: () => void }).collapseAll();
    await settleVirtualScroll(booted.fixture);

    expect(activeIndex(booted)).toBeLessThanOrEqual(rows(booted).length - 1);
  });
});
