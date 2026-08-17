import { describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, Injectable, signal, type WritableSignal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { WorkspaceView } from '../workspace-view';
import { readStoredActiveSection } from '../workspace-view.storage';
import { GraphView } from '../../graph-view/graph-view';
import { ActivityPlaybackService } from '../../../../services/activity-playback';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilterStoreService } from '../../../../services/filter-store';
import { KindRegistryService } from '../../../../services/kind-registry';
import { LiveLensService } from '../../../../services/live-lens';
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
    branch: { paths: [], excluded: [], rootExcluded: false, total: scan.nodes.length, rendered: scan.nodes.length, truncated: false, cap: 256 },
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
  getProjectPreferences: vi.fn().mockResolvedValue({ allowSidecarWriters: true, scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false } }),
  getProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  getRegisteredAnnotations: vi.fn().mockResolvedValue([]),
  lookupContribution: vi.fn().mockResolvedValue(null),
  // The queue panel reads this when its section is active; an empty list
  // renders the queue's empty state.
  listJobs: vi.fn().mockResolvedValue([]),
  cancelJob: vi.fn().mockResolvedValue(undefined),
  events: vi.fn().mockReturnValue(EMPTY),
};

@Injectable()
class FakeMarkdownRenderer extends MarkdownRenderer {
  override async render(): Promise<string> {
    return '';
  }
}

/**
 * Controllable stand-in for the Live lens, so a suite can flip the mode
 * on without a WS socket or a `live` runtime mode. Only the two signals
 * the workspace + rail read are needed (`active` gates the queue tab and
 * the rail narrowing; `membership` IS the narrowed set).
 */
export interface ILensHandles {
  active: WritableSignal<boolean>;
  membership: WritableSignal<ReadonlySet<string>>;
}

/**
 * The stub covers the WHOLE read surface, not just the two driven
 * signals: the mounted `GraphView` also consumes the lens (observed
 * relations, lens nodes / scan, the toolbar controls), and a partial
 * stub throws mid-render, which the jsdom guards below would swallow
 * into an empty DOM and a mystifying assertion failure.
 */
function makeLensStub(lens: ILensHandles): LiveLensService {
  return {
    available: signal(true).asReadonly(),
    active: lens.active.asReadonly(),
    membership: lens.membership.asReadonly(),
    lensNodes: signal<INodeView[]>([]).asReadonly(),
    lensScan: signal<IScanResultApi | null>(null).asReadonly(),
    observedInvocations: signal([]).asReadonly(),
    observedSpawns: signal([]).asReadonly(),
    observedSpinePairs: signal<ReadonlySet<string>>(new Set()).asReadonly(),
    setActive: (value: boolean) => lens.active.set(value),
    reset: () => undefined,
  } as unknown as LiveLensService;
}

async function bootstrap(
  nodes: INodeView[],
  links: ILinkApi[],
  corpusSize = nodes.length,
  lens?: ILensHandles,
): Promise<{
  fixture: ComponentFixture<WorkspaceView>;
  mapVisibility: MapVisibilityService;
}> {
  // Every suite here exercises the Files tab (the tree leaf buttons, the
  // shared search cluster). Pin the rail to Files so a leaked `queue`
  // preference from another spec never mounts the queue panel instead
  // (which would also want `WsEventStreamService`, not provided here).
  localStorage.setItem('sm.workspace.rail-section', 'files');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    // Registered explicitly (standalone components usually need no
    // registration) so `compileComponents()` below can resolve the
    // async metadata its `@defer` block (the queue panel) introduces.
    imports: [WorkspaceView],
    providers: [
      provideRouter([{ path: '', component: BlankPage }]),
      { provide: CollectionLoaderService, useValue: makeLoaderStub(nodes, links, corpusSize) },
      { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
      { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
      // Only when a suite drives the lens: the real service is
      // unavailable in demo mode (so it could never turn on here), and
      // the stub keeps the whole activity graph out of these DOM tests.
      ...(lens === undefined
        ? []
        : [{ provide: LiveLensService, useValue: makeLensStub(lens) }]),
      // The queue panel (mounted when the Queue section is active) injects
      // `WsEventStreamService` for its debounced live refresh. The real
      // service is used here (as before this suite grew the queue tab): in
      // demo mode it opens no socket and its streams derive from `EMPTY`,
      // and other consumers (NodeActivityService) need its full stream set.
    ],
  });
  TestBed.overrideComponent(GraphView, {
    add: {
      providers: [
        { provide: DagreLayoutEngine, useValue: { calculate: vi.fn().mockResolvedValue({ nodes: [] }) } },
      ],
    },
  });
  // The workspace template carries a `@defer` block (the queue panel),
  // which makes the component's metadata resolve asynchronously; without
  // this await, `createComponent` throws "unresolved metadata".
  await TestBed.compileComponents();
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
  // The files rail inside the workspace is a virtualised table: its first
  // render window is computed in a macrotask, so a microtask flush is not
  // enough to have any `<tr>` in the DOM for the clicks below.
  await new Promise((resolve) => setTimeout(resolve, 5));
  try {
    fixture.detectChanges();
  } catch {
    /* same Foblex guard as above */
  }
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
    expect(mapVisibility.overrides().size).toBe(0);

    click(fixture, 'files-leaf-graph-a.md');

    // a + its direct neighbor b are curated onto the map; the 2-hop c is
    // excluded. End-to-end proof that the rail gesture reaches the graph
    // and applies the 1-hop scope, not the whole connected component.
    expect(mapVisibility.overrides().get('a.md')).toBe('include');
    expect(mapVisibility.overrides().get('b.md')).toBe('include');
    expect(mapVisibility.overrides().get('')).toBe('exclude');
    expect(mapVisibility.overrides().has('c.md')).toBe(false);
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
    expect(mapVisibility.overrides().get('a.md')).toBe('include');
    expect(mapVisibility.overrides().get('b.md')).toBe('include');
    expect(mapVisibility.overrides().get('')).toBe('exclude');
    expect(mapVisibility.overrides().has('c.md')).toBe(false);

    // Re-isolating the same node while the map still shows its neighborhood
    // restores the prior (empty == show-all) visibility.
    click(fixture, 'files-leaf-graph-a.md');
    expect(mapVisibility.overrides().size).toBe(0);
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
    mapVisibility.setSubtree('src', 'exclude');
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
    expect(mapVisibility.overrides().size).toBe(0);
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

describe('WorkspaceView search clear button', () => {
  const clearEl = (fixture: ComponentFixture<WorkspaceView>): HTMLButtonElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="workspace-search-clear"]',
    );

  it('shows the clear button only while the search has text, and clears just the query', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], []);
    const store = TestBed.inject(FilterStoreService);

    // Empty query: no clear affordance.
    expect(clearEl(fixture)).toBeNull();

    store.setSearchText('foo');
    fixture.detectChanges();
    expect(store.searchText()).toBe('foo');
    const btn = clearEl(fixture);
    expect(btn).not.toBeNull();

    // Clicking it empties the query and the button disappears again.
    btn!.click();
    fixture.detectChanges();
    expect(store.searchText()).toBe('');
    expect(clearEl(fixture)).toBeNull();
    localStorage.removeItem('sm.workspace.rail-collapsed');
  });
});

describe('WorkspaceView activity sections', () => {
  function railEl(fixture: ComponentFixture<WorkspaceView>): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="workspace-rail"]',
    ) as HTMLElement;
  }
  const q = (fixture: ComponentFixture<WorkspaceView>, testid: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-testid="${testid}"]`,
    );

  it('collapses to an icon bar (Files active, no chevron) and opens onto the clicked section', async () => {
    // Small corpus + nothing persisted collapses the rail (map front-and-
    // center); `bootstrap` pins the section to Files.
    localStorage.removeItem('sm.workspace.rail-collapsed');
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], []);

    // Collapsed: the activity icon bar renders (Files + Queue) and the chevron
    // toggle does NOT (it only shows when open). No icon reads as "selected"
    // while collapsed, the lit state belongs to the open tab strip.
    expect(railEl(fixture).classList.contains('is-collapsed')).toBe(true);
    expect(q(fixture, 'workspace-rail-toggle')).toBeNull();
    const filesBtn = q(fixture, 'workspace-section-files');
    const queueBtn = q(fixture, 'workspace-section-queue');
    expect(filesBtn).not.toBeNull();
    expect(queueBtn).not.toBeNull();
    expect(filesBtn!.classList.contains('is-active')).toBe(false);
    expect(queueBtn!.classList.contains('is-active')).toBe(false);

    // Clicking the Queue icon opens the rail onto the queue panel.
    queueBtn!.click();
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }
    // The queue panel sits behind `@defer` (Playthrough behavior in
    // TestBed): its chunk resolves through a dynamic import, i.e. at
    // least one macrotask, so a bare microtask flush would assert
    // before the deferred content renders.
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      fixture.detectChanges();
    } catch {
      /* same Foblex guard as above */
    }

    expect(railEl(fixture).classList.contains('is-collapsed')).toBe(false);
    // Open: the chevron now exists, the Queue tab is active, and the queue
    // panel replaced the files navigator in the body.
    expect(q(fixture, 'workspace-rail-toggle')).not.toBeNull();
    expect(q(fixture, 'workspace-section-queue')!.classList.contains('is-active')).toBe(true);
    expect(q(fixture, 'queue-view')).not.toBeNull();
    expect(q(fixture, 'files-view')).toBeNull();

    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('shows the search cluster only on the Files tab, not on Queue', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], []);

    // Files is the default section: the search + the filter toggles render.
    expect(q(fixture, 'workspace-search')).not.toBeNull();
    expect(q(fixture, 'workspace-reset-filters')).not.toBeNull();

    // Switch to Queue: the whole search cluster is gone (it filters the file
    // tree / map, which the queue panel does not use).
    q(fixture, 'workspace-section-queue')!.click();
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }
    await Promise.resolve();
    expect(q(fixture, 'workspace-search')).toBeNull();
    expect(q(fixture, 'workspace-reset-filters')).toBeNull();

    // Back to Files: the cluster returns.
    q(fixture, 'workspace-section-files')!.click();
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }
    await Promise.resolve();
    expect(q(fixture, 'workspace-search')).not.toBeNull();

    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('disables the Queue tab while the Live lens is on, and clicking it is inert', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const lens: ILensHandles = {
      active: signal(true),
      membership: signal<ReadonlySet<string>>(new Set(['a.md'])),
    };
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], [], 1, lens);

    // Disabled via `aria-disabled` (the control stays focusable so its
    // tooltip can explain), and the dimming class rides along.
    const queueTab = q(fixture, 'workspace-section-queue')!;
    expect(queueTab.getAttribute('aria-disabled')).toBe('true');
    expect(queueTab.classList.contains('is-disabled')).toBe(true);

    // The click routes through `openSection`, whose guard drops it: the
    // rail stays on Files and the queue panel never mounts.
    queueTab.click();
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(q(fixture, 'files-view')).not.toBeNull();
    expect(q(fixture, 'queue-view')).toBeNull();

    // Leaving the lens re-enables it.
    lens.active.set(false);
    try {
      fixture.detectChanges();
    } catch {
      /* same guard */
    }
    expect(q(fixture, 'workspace-section-queue')!.getAttribute('aria-disabled')).toBeNull();

    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('entering the lens moves the rail off an open Queue panel', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const lens: ILensHandles = {
      active: signal(false),
      membership: signal<ReadonlySet<string>>(new Set()),
    };
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], [], 1, lens);

    q(fixture, 'workspace-section-queue')!.click();
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      fixture.detectChanges();
    } catch {
      /* same guard */
    }
    expect(q(fixture, 'queue-view')).not.toBeNull();

    // The lens turns on: the panel it just disabled must not stay open.
    lens.active.set(true);
    try {
      fixture.detectChanges();
    } catch {
      /* same guard */
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      fixture.detectChanges();
    } catch {
      /* same guard */
    }
    expect(q(fixture, 'queue-view')).toBeNull();
    expect(q(fixture, 'files-view')).not.toBeNull();

    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('narrows the files rail to the lens membership, with its own empty state', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const lens: ILensHandles = {
      active: signal(false),
      membership: signal<ReadonlySet<string>>(new Set()),
    };
    const { fixture } = await bootstrap(
      [makeNode('a.md', 'a'), makeNode('b.md', 'b')],
      [],
      2,
      lens,
    );
    const settle = async (): Promise<void> => {
      try {
        fixture.detectChanges();
      } catch {
        /* ignore Foblex-internal render glitches in jsdom */
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        fixture.detectChanges();
      } catch {
        /* same guard */
      }
    };

    // Lens off: the rail lists the whole corpus.
    expect(q(fixture, 'files-leaf-graph-a.md')).not.toBeNull();
    expect(q(fixture, 'files-leaf-graph-b.md')).not.toBeNull();

    // Lens on with only a.md seen executing: b.md leaves the rail.
    lens.active.set(true);
    lens.membership.set(new Set(['a.md']));
    await settle();
    expect(q(fixture, 'files-leaf-graph-a.md')).not.toBeNull();
    expect(q(fixture, 'files-leaf-graph-b.md')).toBeNull();

    // Nothing seen yet: the lens empty state, NOT the filters one (the
    // facets are not what emptied the list).
    lens.membership.set(new Set());
    await settle();
    expect(q(fixture, 'files-empty-lens')).not.toBeNull();
    expect(q(fixture, 'files-empty-filtered')).toBeNull();

    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('the open chevron collapses the rail without swapping panels', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], []);
    expect(railEl(fixture).classList.contains('is-collapsed')).toBe(false);

    q(fixture, 'workspace-rail-toggle')!.click();
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }
    await Promise.resolve();

    expect(railEl(fixture).classList.contains('is-collapsed')).toBe(true);
    // Collapsed again: the icon bar is back, the chevron is gone.
    expect(q(fixture, 'workspace-rail-toggle')).toBeNull();
    expect(q(fixture, 'workspace-section-files')).not.toBeNull();
    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('the Sessions tab stays ENABLED during the lens and opens its panel', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    const lens: ILensHandles = {
      active: signal(true),
      membership: signal<ReadonlySet<string>>(new Set(['a.md'])),
    };
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], [], 1, lens);

    // Contrast with Queue: same lens, opposite gating (this tab is the
    // lens's own front door, so it must stay reachable).
    const sessionsTab = q(fixture, 'workspace-section-sessions')!;
    expect(q(fixture, 'workspace-section-queue')!.getAttribute('aria-disabled')).toBe('true');
    expect(sessionsTab.getAttribute('aria-disabled')).toBeNull();

    sessionsTab.click();
    try {
      fixture.detectChanges();
    } catch {
      /* ignore Foblex-internal render glitches in jsdom */
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      fixture.detectChanges();
    } catch {
      /* same guard */
    }
    expect(q(fixture, 'sessions-view')).not.toBeNull();
    expect(q(fixture, 'files-view')).toBeNull();
    // No frames recorded in these DOM tests: the panel's own empty state.
    expect(q(fixture, 'sessions-empty-none')).not.toBeNull();
    // The search cluster is files-only chrome.
    expect(q(fixture, 'workspace-search')).toBeNull();

    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('the sessions Play intent enters a lens replay scoped to the selection', async () => {
    localStorage.setItem('sm.workspace.rail-collapsed', '0');
    // Seed the recorder through its own persistence: hydration is not
    // gated on Real Time, so a stored tape is the cheapest way to hand
    // the REAL recorder a session without a WS socket.
    const t0 = 1_700_000_000_000;
    localStorage.setItem(
      'sm.live.recording',
      JSON.stringify([
        {
          tMs: t0,
          type: 'node.activity',
          data: { nodePath: 'a.md', phase: 'start', owner: 'main:s1' },
        },
        {
          tMs: t0 + 100,
          type: 'node.activity',
          data: { nodePath: 'a.md', phase: 'start', owner: 'main:other' },
        },
      ]),
    );
    const lens: ILensHandles = {
      active: signal(false),
      membership: signal<ReadonlySet<string>>(new Set()),
    };
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], [], 1, lens);

    // The rail gesture routes rail -> workspace -> graph view -> playback.
    fixture.componentInstance.replaySession({ rootOwner: 'main:s1' }, 'Session 1');
    const playback = TestBed.inject(ActivityPlaybackService);
    expect(playback.active()).toBe(true);
    // Scoped: only main:s1's frame, not the other session's.
    expect(playback.total()).toBe(1);
    expect(playback.scopeLabel()).toBe('Session 1');
    // Entering from the rail turned the lens on.
    expect(lens.active()).toBe(true);

    playback.exit();
    localStorage.removeItem('sm.live.recording');
    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('a step deep-link lands the replay ON that frame and PAUSED', async () => {
    const t0 = 1_700_000_000_000;
    localStorage.setItem(
      'sm.live.recording',
      JSON.stringify([
        {
          tMs: t0,
          type: 'node.activity',
          data: { nodePath: 'a.md', phase: 'start', owner: 'main:s1' },
        },
        {
          tMs: t0 + 100,
          type: 'node.activity',
          data: { nodePath: 'a.md', phase: 'start', owner: 'main:s1', detail: 'Read', access: 'read' },
        },
      ]),
    );
    const lens: ILensHandles = {
      active: signal(false),
      membership: signal<ReadonlySet<string>>(new Set()),
    };
    const { fixture } = await bootstrap([makeNode('a.md', 'a')], [], 1, lens);

    fixture.componentInstance.replaySession({ rootOwner: 'main:s1' }, 'Session 1', {
      tMs: t0 + 100,
      path: 'a.md',
      detail: 'Read',
      access: 'read',
    });
    const playback = TestBed.inject(ActivityPlaybackService);
    expect(playback.active()).toBe(true);
    // Landed on the step's frame, and PAUSED there: the operator asked
    // to look at a moment, not to watch from it (user call 2026-08-16).
    expect(playback.cursor()).toBe(1);
    expect(playback.playing()).toBe(false);

    playback.exit();
    localStorage.removeItem('sm.live.recording');
    localStorage.removeItem('sm.workspace.rail-collapsed');
    localStorage.removeItem('sm.workspace.rail-section');
  });

  it('the stored rail section accepts sessions', () => {
    localStorage.setItem('sm.workspace.rail-section', 'sessions');
    expect(readStoredActiveSection()).toBe('sessions');
    localStorage.setItem('sm.workspace.rail-section', 'bogus');
    expect(readStoredActiveSection()).toBeNull();
    localStorage.removeItem('sm.workspace.rail-section');
  });
});
