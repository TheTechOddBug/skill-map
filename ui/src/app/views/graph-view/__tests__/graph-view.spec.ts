import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, Injectable, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { GraphView } from '../graph-view';
import { CollectionLoaderService } from '../../../../services/collection-loader';
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
} from '../../../../models/api';

/**
 * `GraphView`, selection / URL-sync / panel-close behaviour. Tests
 * focus on the public API surface (`selectedNodeId`, `selectedPath`,
 * `closePanel`, `onEscape`, the URL writer effect). Foblex Flow
 * rendering is skipped intentionally, the canvas mounts inside the
 * `@if (!hasData())` else-branch, and the layout/render concerns are
 * covered by `graph-layout.spec.ts` plus visual smoke in dev.
 */

@Component({ template: '' })
class BlankPage {}

interface IStubLoader {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  scan: ReturnType<typeof signal<IScanResultApi | null>>;
  scanMeta: ReturnType<typeof signal<IScanResultApi | null>>;
  liteNodes: ReturnType<typeof signal<IFolderNodeLite[]>>;
  liteNodeViews: ReturnType<typeof signal<INodeView[]>>;
  branch: ReturnType<typeof signal<IBranchResponseApi | null>>;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<string | null>>;
  hasAnyFavorites: ReturnType<typeof signal<boolean>>;
  load: ReturnType<typeof vi.fn>;
  toggleFavorite: ReturnType<typeof vi.fn>;
}

function makeNode(path: string, name: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: {
      name,
      description: '',
      metadata: { version: '1.0.0' },
    },
  };
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  const meta: IScanResultApi = {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    providers: [],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: initialNodes.length,
      filesSkipped: 0,
      nodesCount: initialNodes.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const branchNodes = initialNodes.map((n) => ({
    path: n.path,
    kind: n.kind,
    provider: 'claude',
    bodyHash: 'h',
    frontmatterHash: 'fh',
    bytes: { frontmatter: 1, body: 1, total: 2 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  }));
  const branch: IBranchResponseApi = {
    schemaVersion: '1',
    kind: 'branch',
    branch: {
      paths: [],
      total: branchNodes.length,
      rendered: branchNodes.length,
      truncated: false,
      cap: 256,
    },
    nodes: branchNodes,
    links: [],
    issues: [],
  };
  return {
    nodes: signal(initialNodes),
    // `scan()` is branch-scoped: meta scalars fused with branch payload.
    scan: signal<IScanResultApi | null>({ ...meta, nodes: branchNodes }),
    scanMeta: signal<IScanResultApi | null>(meta),
    liteNodes: signal<IFolderNodeLite[]>(
      initialNodes.map((n) => ({
        path: n.path,
        kind: n.kind,
        linksInCount: 0,
        linksOutCount: 0,
        tokensTotal: null,
        modifiedAtMs: null,
        errorCount: 0,
        warnCount: 0,
      })),
    ),
    liteNodeViews: signal<INodeView[]>(
      initialNodes.map((n) => ({ path: n.path, kind: n.kind, frontmatter: { name: '', description: '' } }) as INodeView),
    ),
    branch: signal<IBranchResponseApi | null>(branch),
    loading: signal(false),
    error: signal<string | null>(null),
    hasAnyFavorites: signal(initialNodes.some((n) => n.isFavorite === true)),
    load: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
}

const STUB_DATA_SOURCE: IDataSourcePort = {
  health: vi.fn(),
  loadScan: vi.fn(),
  loadScanMeta: vi.fn(),
  loadFolders: vi.fn().mockResolvedValue([]),
  loadBranch: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'branch',
    branch: { paths: [], total: 0, rendered: 0, truncated: false, cap: 256 },
    nodes: [],
    links: [],
    issues: [],
  }),
  listNodes: vi.fn(),
  getNode: vi.fn().mockResolvedValue(null),
  listLinks: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'links',
    items: [],
    filters: { kind: null, from: null, to: null },
    counts: { total: 0, returned: 0 },
    kindRegistry: {},
  }),
  listIssues: vi.fn(),
  loadGraph: vi.fn(),
  loadConfig: vi.fn(),
  listPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  setPluginExtensionEnabled: vi.fn(),
  applyPluginChanges: vi.fn(),
  runScan: vi.fn(),
  setFavorite: vi.fn().mockResolvedValue(undefined),
  unsetFavorite: vi.fn().mockResolvedValue(undefined),
  getPreferences: vi
    .fn()
    .mockResolvedValue({
      updateCheck: { enabled: true },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  setPreferences: vi
    .fn()
    .mockResolvedValue({
      updateCheck: { enabled: true },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  getProjectPreferences: vi
    .fn()
    .mockResolvedValue({ allowSidecarWriters: true, scan: { referencePaths: [] } }),
  setProjectPreferences: vi
    .fn()
    .mockResolvedValue({ allowSidecarWriters: true, scan: { referencePaths: [] } }),
  getProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  setProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  getActiveProvider: vi
    .fn()
    .mockResolvedValue({ activeProvider: null, detected: [], source: 'none' as const, selectable: [] }),
  setActiveProvider: vi.fn().mockResolvedValue({
    activeProvider: null,
    detected: [],
    source: 'none' as const,
    selectable: [],
    switch: { dropped: null },
  }),
  lookupContribution: vi.fn().mockResolvedValue(null),
  bumpSidecar: vi.fn(),
  dispatchAction: vi.fn(),
  getUpdateStatus: vi.fn().mockResolvedValue({
    current: '0.0.0',
    latest: null,
    isOutdated: false,
    checkedAt: null,
    shownAt: null,
  }),
  getRegisteredAnnotations: vi.fn().mockResolvedValue([]),
  events: vi.fn().mockReturnValue(EMPTY),
};

@Injectable()
class FakeMarkdownRenderer extends MarkdownRenderer {
  override async render(): Promise<string> {
    return '';
  }
}

async function bootstrap(initialNodes: INodeView[]): Promise<{
  fixture: ComponentFixture<GraphView>;
  cmp: GraphView;
  loader: IStubLoader;
  router: Router;
}> {
  const loader = makeStubLoader(initialNodes);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: BlankPage },
      ]),
      { provide: CollectionLoaderService, useValue: loader },
      { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
      { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
      // `WsEventStreamService` is pulled transitively (via `InspectorView` /
      // `LinkedNodesPanel`) and `inject(SKILL_MAP_MODE)` fires at instance
      // construction. Provide `'demo'` so the service short-circuits to
      // `EMPTY` and never tries to open a real socket in JSDOM.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
    ],
  });
  // Stub the dagre engine: vitest's JSDOM environment can't interop
  // the upstream `dagre` CJS module the same way the production
  // bundle does. The component-level provider from `provideFLayout`
  // wins over a root-level override, so we append our stub to the
  // component's providers via `overrideComponent({ add })`, last
  // provider wins for a given token. These tests don't probe layout
  // anyway (selection / URL sync / panel-close), the engine call is
  // muted to keep the test runner quiet.
  TestBed.overrideComponent(GraphView, {
    add: {
      providers: [
        {
          provide: DagreLayoutEngine,
          useValue: { calculate: vi.fn().mockResolvedValue({ nodes: [] }) },
        },
      ],
    },
  });
  // Seed the kind registry so the layout's per-kind splits resolve.
  TestBed.inject(KindRegistryService).ingest({
    agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/');
  const fixture = TestBed.createComponent(GraphView);
  // Construction wires the effects but DOES NOT detect changes, that
  // would render the Foblex template, which is not our concern. We
  // poke methods on the instance directly and let effects flush via
  // `flush()` below.
  return { fixture, cmp: fixture.componentInstance, loader, router };
}

/** Drive the effect runner without rendering the template. */
async function flushEffects(fixture: ComponentFixture<GraphView>): Promise<void> {
  // `detectChanges` runs the effect runner; calling it is enough to
  // surface signal-driven behaviour. We call it inside a try/catch
  // because the `@else` Foblex branch tries to render `f-flow`
  // descendants in JSDOM, geometry APIs (ResizeObserver,
  // getBoundingClientRect) may throw or return zeros, but the
  // selection / URL effects we care about already ran by the time
  // any render error surfaces.
  try {
    fixture.detectChanges();
  } catch {
    // Ignore Foblex-internal render glitches in JSDOM.
  }
  await Promise.resolve();
  await Promise.resolve();
}

describe('GraphView, selection and URL sync', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('selects a node and exposes its path via selectedPath()', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });

  it('writes the selected path into the URL `?path=` query param', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp, router } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    // Allow router navigation microtask to land.
    await new Promise((r) => setTimeout(r, 0));

    expect(router.url).toContain(`path=${encodeURIComponent(node.path)}`);
  });

  it('removes the `?path=` param when selection is cleared via closePanel()', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp, router } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toContain('path=');

    cmp.closePanel();
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));

    expect(cmp.selectedNodeId()).toBeNull();
    expect(router.url).not.toContain('path=');
  });

  it('Escape clears the selection when the panel is open', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    cmp.onEscape();
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
  });

  it('Escape is a no-op when nothing is selected (does not break key propagation)', async () => {
    const { fixture, cmp } = await bootstrap([
      makeNode('agents/architect.md', 'architect'),
    ]);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
    cmp.onEscape();
    expect(cmp.selectedNodeId()).toBeNull();
  });
});

describe('GraphView, deep-link reader', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens the panel for a node when the URL carries `?path=…`', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const loader = makeStubLoader([node]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankPage },
        ]),
        { provide: CollectionLoaderService, useValue: loader },
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
        // See note in the sibling describe: `WsEventStreamService` pulls
        // `SKILL_MAP_MODE` transitively; `'demo'` keeps the socket closed.
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
      ],
    });
    TestBed.inject(KindRegistryService).ingest({
      agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(`/?path=${encodeURIComponent(node.path)}`);

    const fixture = TestBed.createComponent(GraphView);
    const cmp = fixture.componentInstance;
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });
});

describe('GraphView, isolate (1-hop neighborhood)', () => {
  beforeEach(() => {
    // Selection persists in localStorage; clear it so each isolate test
    // starts from an empty (show-all) selection.
    localStorage.removeItem('sm.map.visible-paths');
    TestBed.resetTestingModule();
  });

  it('re-selects the node + DIRECT neighbors as the map SELECTION, excluding 2-hop nodes', async () => {
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const c = makeNode('c.md', 'c'); // 2 hops from a (a-b-c): must NOT survive
    const { fixture, cmp, loader } = await bootstrap([a, b, c]);
    // a -> b -> c. With the old connected-component scope, isolating `a`
    // would keep all three (the graph is one component); 1-hop keeps {a, b}.
    loader.scan.set({
      ...loader.scan()!,
      links: [
        { source: 'a.md', target: 'b.md', kind: 'references', confidence: 1, sources: ['x'] },
        { source: 'b.md', target: 'c.md', kind: 'references', confidence: 1, sources: ['x'] },
      ],
    });
    await flushEffects(fixture);

    const mapVisibility = TestBed.inject(MapVisibilityService);
    // Baseline: no selection.
    expect(mapVisibility.paths().size).toBe(0);

    cmp.isolateNeighborhood('a.md');
    await flushEffects(fixture);

    // Isolate now applies the scope SERVER-SIDE: it re-selects the node +
    // its direct neighbor b (so the loader re-fetches that union); the
    // 2-hop c is excluded. The origin stays selected. The branch render
    // itself follows the loader's re-fetch (stubbed here), so we assert
    // on the selection the gesture wrote, mirroring workspace-view.isolate.
    expect(new Set(mapVisibility.paths())).toEqual(new Set(['a.md', 'b.md']));
    expect(cmp.selectedNodeId()).toBe('a.md');
  });

  it('isolates an orphan node down to itself alone (selection = just the node)', async () => {
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const { fixture, cmp } = await bootstrap([a, b]);
    await flushEffects(fixture);

    cmp.isolateNeighborhood('a.md');
    await flushEffects(fixture);

    const mapVisibility = TestBed.inject(MapVisibilityService);
    expect(new Set(mapVisibility.paths())).toEqual(new Set(['a.md']));
  });
});

describe('GraphView, inspector width reservation', () => {
  // `reservedPanelWidth` feeds both the panel-blind viewport math
  // (auto-fit / center pan reserve it as `panelW`) and the floating
  // toolbar's horizontal centering (it dodges the inspector overlay via
  // `--sm-graph-inspector-w`). The CSS transform itself is verified
  // visually, here we only pin the reactive value the centering depends
  // on. Members are `protected`, so the cast reaches them the same way a
  // template binding would. Foblex is never rendered (see the file
  // header), so this stays in the JSDOM-safe API surface.
  type WithReservation = { reservedPanelWidth: () => number; clampedPanelWidth: () => number };

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('reserves zero width while no node is selected', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
    expect((cmp as unknown as WithReservation).reservedPanelWidth()).toBe(0);
  });

  it('reserves the live panel width once a node is selected', async () => {
    const node = makeNode('a.md', 'a');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    const view = cmp as unknown as WithReservation;
    expect(view.reservedPanelWidth()).toBe(view.clampedPanelWidth());
    expect(view.reservedPanelWidth()).toBeGreaterThan(0);
  });

  it('drops the reservation back to zero when the panel closes', async () => {
    const node = makeNode('a.md', 'a');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    expect((cmp as unknown as WithReservation).reservedPanelWidth()).toBeGreaterThan(0);

    cmp.closePanel();
    await flushEffects(fixture);

    expect((cmp as unknown as WithReservation).reservedPanelWidth()).toBe(0);
  });
});

describe('GraphView, branch rendering + cap banner', () => {
  beforeEach(() => {
    // Map-visibility curation persists in localStorage; a prior isolate
    // test can leave a non-empty inclusion set that would narrow the
    // canvas here. Clear it so the branch projection is the only filter.
    localStorage.removeItem('sm.map.visible-paths');
    TestBed.resetTestingModule();
  });

  it('renders the branch node set on the map (the projected graph)', async () => {
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const { fixture, cmp } = await bootstrap([a, b]);
    await flushEffects(fixture);

    // `graph()` projects the loader's branch node set; both branch nodes
    // are on the canvas.
    expect(new Set(cmp.graph().nodes.map((n) => n.id))).toEqual(new Set(['a.md', 'b.md']));
    expect(cmp.hasData()).toBe(true);
  });

  it('shows the branch-cap banner when the loaded branch is truncated', async () => {
    const { fixture, loader } = await bootstrap([makeNode('a.md', 'a')]);
    // Mark the branch truncated: more nodes in the folder than rendered.
    loader.branch.set({
      ...loader.branch()!,
      branch: { paths: [], total: 900, rendered: 1, truncated: true, cap: 1 },
    });
    await flushEffects(fixture);

    const banner = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="branch-cap-banner"]',
    );
    expect(banner).not.toBeNull();
    const body = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="branch-cap-banner-body"]',
    );
    expect(body?.textContent).toContain('900');
  });

  it('hides the branch-cap banner when the branch fits under the cap', async () => {
    const { fixture, loader } = await bootstrap([makeNode('a.md', 'a')]);
    loader.branch.set({
      ...loader.branch()!,
      branch: { paths: [], total: 1, rendered: 1, truncated: false, cap: 256 },
    });
    await flushEffects(fixture);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="branch-cap-banner"]'),
    ).toBeNull();
  });
});
