import { describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, Injectable, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { WorkspaceView } from '../workspace-view';
import { GraphView } from '../../graph-view/graph-view';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilterStoreService } from '../../../../services/filter-store';
import { KindRegistryService } from '../../../../services/kind-registry';
import { MapVisibilityService } from '../../../../services/map-visibility';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import type { INodeView } from '../../../../models/node';
import type {
  IBranchResponseApi,
  IFolderNodeLite,
  IScanResultApi,
  ILinkApi,
} from '../../../../models/api';

/**
 * WorkspaceView end-to-end isolate wiring.
 *
 * Exercises the FULL chain the unit specs stub out: the rail's sitemap
 * button -> `MAP_ISOLATE_INTENT` (the WorkspaceView itself) -> the
 * mounted `GraphView.isolateNeighborhood` via the `viewChild`. The
 * regression guarded here is the isolate gesture behaving like a plain
 * row click (open/select) instead of curating the map down to the node's
 * 1-hop neighborhood: if the `viewChild(GraphView)` ever stops resolving,
 * `isolate` becomes a silent no-op and `MapVisibilityService` is never
 * written.
 */

@Component({ template: '' })
class BlankPage {}

function makeNode(path: string, name: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name, description: '', metadata: { version: '1.0.0' } },
  };
}

function makeLoaderStub(nodes: INodeView[], links: ILinkApi[], corpusSize = nodes.length) {
  const scan: IScanResultApi = {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    providers: [],
    nodes: nodes.map((n) => ({
      path: n.path,
      kind: n.kind,
      provider: 'claude',
      bodyHash: 'h',
      frontmatterHash: 'fh',
      bytes: { frontmatter: 1, body: 1, total: 2 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
    })),
    links,
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: links.length,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const branch: IBranchResponseApi = {
    schemaVersion: '1',
    kind: 'branch',
    branch: { paths: [], total: scan.nodes.length, rendered: scan.nodes.length, truncated: false, cap: 256 },
    nodes: scan.nodes,
    links,
    issues: [],
  };
  return {
    nodes: signal(nodes),
    scan: signal<IScanResultApi | null>(scan),
    scanMeta: signal<IScanResultApi | null>({ ...scan, nodes: [], links: [], issues: [] }),
    liteNodes: signal<IFolderNodeLite[]>(
      nodes.map((n) => ({
        path: n.path,
        kind: n.kind,
        linksInCount: 0,
        linksOutCount: 0,
        tokensTotal: null,
        modifiedAtMs: null,
        errorCount: 0,
        warnCount: 0,
        sidecarStatus: null,
      })),
    ),
    // The files-view (a child of the workspace) builds its tree from
    // `liteNodeViews()`; project the same minimal shape the loader does.
    liteNodeViews: signal<INodeView[]>(
      nodes.map((n) => ({ path: n.path, kind: n.kind, frontmatter: { name: '', description: '' } }) as INodeView),
    ),
    branch: signal<IBranchResponseApi | null>(branch),
    corpusCount: signal(corpusSize),
    loading: signal(false),
    error: signal<string | null>(null),
    hasAnyFavorites: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
}

const STUB_DATA_SOURCE: Partial<IDataSourcePort> = {
  getNode: vi.fn().mockResolvedValue(null),
  listLinks: vi.fn().mockResolvedValue({
    schemaVersion: '1', kind: 'links', items: [], filters: {}, counts: { total: 0, returned: 0 }, kindRegistry: {},
  }),
  getActiveProvider: vi
    .fn()
    .mockResolvedValue({ activeProvider: 'markdown', detected: [], source: 'default' as const, selectable: [], markerDrift: null }),
  getProjectPreferences: vi.fn().mockResolvedValue({ allowSidecarWriters: true, scan: { referencePaths: [] } }),
  getProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  getRegisteredAnnotations: vi.fn().mockResolvedValue([]),
  lookupContribution: vi.fn().mockResolvedValue(null),
  events: vi.fn().mockReturnValue(EMPTY),
};

@Injectable()
class FakeMarkdownRenderer extends MarkdownRenderer {
  override async render(): Promise<string> {
    return '';
  }
}

async function bootstrap(nodes: INodeView[], links: ILinkApi[], corpusSize = nodes.length): Promise<{
  fixture: ComponentFixture<WorkspaceView>;
  mapVisibility: MapVisibilityService;
}> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideNoopAnimations(),
      provideRouter([{ path: '', component: BlankPage }]),
      { provide: CollectionLoaderService, useValue: makeLoaderStub(nodes, links, corpusSize) },
      { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
      { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
    ],
  });
  TestBed.overrideComponent(GraphView, {
    add: {
      providers: [
        { provide: DagreLayoutEngine, useValue: { calculate: vi.fn().mockResolvedValue({ nodes: [] }) } },
      ],
    },
  });
  TestBed.inject(KindRegistryService).ingest({
    agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
  });
  const mapVisibility = TestBed.inject(MapVisibilityService);
  mapVisibility.clear();
  await TestBed.inject(Router).navigateByUrl('/');
  const fixture = TestBed.createComponent(WorkspaceView);
  // Foblex's f-flow tries to measure geometry in jsdom and can throw; the
  // selection / isolate effects we care about already ran by then.
  try {
    fixture.detectChanges();
  } catch {
    /* ignore Foblex-internal render glitches in jsdom */
  }
  await Promise.resolve();
  return { fixture, mapVisibility };
}

function click(fixture: ComponentFixture<WorkspaceView>, testid: string): void {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    `[data-testid="${testid}"]`,
  );
  if (!el) throw new Error(`missing element [data-testid="${testid}"]`);
  el.click();
}

describe('WorkspaceView isolate wiring', () => {
  it('rail sitemap button isolates the node + direct neighbors on the map', async () => {
    // The files rail defaults to collapsed (and the file tree is gated
    // behind it), so open it via the persisted flag before bootstrapping
    // so the sitemap leaf button renders.
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const c = makeNode('c.md', 'c'); // 2 hops from a (a-b-c): must NOT be curated in
    const links: ILinkApi[] = [
      { source: 'a.md', target: 'b.md', kind: 'references', confidence: 1, sources: ['x'] },
      { source: 'b.md', target: 'c.md', kind: 'references', confidence: 1, sources: ['x'] },
    ];
    const { fixture, mapVisibility } = await bootstrap([a, b, c], links);

    // Baseline: no curation.
    expect(mapVisibility.paths().size).toBe(0);

    click(fixture, 'files-leaf-graph-a.md');

    // a + its direct neighbor b are curated onto the map; the 2-hop c is
    // excluded. End-to-end proof that the rail gesture reaches the graph
    // and applies the 1-hop scope, not the whole connected component.
    expect(new Set(mapVisibility.paths())).toEqual(new Set(['a.md', 'b.md']));
  });

  it('a second sitemap click on the same node toggles the map back to show-all', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const links: ILinkApi[] = [
      { source: 'a.md', target: 'b.md', kind: 'references', confidence: 1, sources: ['x'] },
    ];
    const { fixture, mapVisibility } = await bootstrap([a, b], links);

    click(fixture, 'files-leaf-graph-a.md');
    expect(new Set(mapVisibility.paths())).toEqual(new Set(['a.md', 'b.md']));

    // Re-isolating the same node while the map still shows its neighborhood
    // restores the prior (empty == show-all) visibility.
    click(fixture, 'files-leaf-graph-a.md');
    expect(mapVisibility.paths().size).toBe(0);
    expect(mapVisibility.isActive()).toBe(false);
  });
});

describe('WorkspaceView files rail collapse default', () => {
  function railEl(fixture: ComponentFixture<WorkspaceView>): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="workspace-rail"]',
    ) as HTMLElement;
  }

  it('defaults the files rail to collapsed for a small corpus when nothing is persisted', async () => {
    localStorage.removeItem('sm.workspace.rail-collapsed');
    // corpusCount (1) <= maxRenderNodes (256): the map shows everything, so
    // the rail stays collapsed (map front-and-center).
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], []);
    // Collapsed: the rail carries the modifier class and its body (the
    // resize handle gating the file tree) is not mounted.
    expect(railEl(fixture).classList.contains('is-collapsed')).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="workspace-rail-resize"]',
      ),
    ).toBeNull();
  });

  it('auto-opens the files rail when the corpus exceeds the render cap and nothing is persisted', async () => {
    localStorage.removeItem('sm.workspace.rail-collapsed');
    // corpusCount (300) > maxRenderNodes (256): the map renders only a
    // subset, so the folders tree opens by default to navigate it.
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], [], 300);
    expect(railEl(fixture).classList.contains('is-collapsed')).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="workspace-rail-resize"]',
      ),
    ).not.toBeNull();
  });

  it('respects a persisted open rail', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], []);
    expect(railEl(fixture).classList.contains('is-collapsed')).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="workspace-rail-resize"]',
      ),
    ).not.toBeNull();
    localStorage.removeItem('sm.workspace.rail-collapsed');
  });
});

describe('WorkspaceView rail reset control', () => {
  it('clears the map selection AND resets the facet filters in one click', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const { fixture, mapVisibility } = await bootstrap([makeNode('a.md', 'a')], []);
    const store = TestBed.inject(FilterStoreService);

    // Seed both axes the control resets: a facet filter and a folder
    // selection. The button only lights up when one of them is active.
    store.setSearchText('foo');
    mapVisibility.toggleFolder('src');
    expect(store.isActive()).toBe(true);
    expect(mapVisibility.isActive()).toBe(true);
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }

    click(fixture, 'workspace-reset-filters');

    // One click both shows-all (clears the selection) and resets every facet.
    expect(store.isActive()).toBe(false);
    expect(mapVisibility.paths().size).toBe(0);
  });

  it('disables the reset control when there is nothing active to reset', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], []);
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="workspace-reset-filters"]',
    );
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
    localStorage.removeItem('sm.workspace.rail-collapsed');
  });
});
