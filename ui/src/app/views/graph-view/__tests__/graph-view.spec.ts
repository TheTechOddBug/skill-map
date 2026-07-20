import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, Injectable, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { GraphView } from '../graph-view';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { KindRegistryService } from '../../../../services/kind-registry';
import { LivePreferencesService } from '../../../../services/live-preferences';
import { MapVisibilityService } from '../../../../services/map-visibility';
import { NodeActivityService, type INodeInvocation } from '../../../../services/node-activity';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import type { ISpawnThread } from '../../../components/conversation-dialog/spawn-thread';
import type { INodeView } from '../../../../models/node';
import type {
  IActivitySpawnDetailApi,
  IActivitySpawnRecordApi,
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
  corpusCount: ReturnType<typeof signal<number>>;
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
        sidecarStatus: null,
      })),
    ),
    liteNodeViews: signal<INodeView[]>(
      initialNodes.map((n) => ({ path: n.path, kind: n.kind, frontmatter: { name: '', description: '' } }) as INodeView),
    ),
    corpusCount: signal<number>(initialNodes.length),
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
  getNodeFindings: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'findings',
    items: [],
    filters: {},
    counts: { total: 0, returned: 0, dismissedExcluded: 0, fixedExcluded: 0, staleExcluded: 0 },
    kindRegistry: {},
  }),
  getNodeProbExtensions: vi
    .fn()
    .mockResolvedValue({ finders: [], standalone: [] }),
  submitNodeJob: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'job.submitted',
    value: { jobId: 'job-1', nodePath: 'a.md', extensionId: 'x/y', supersededIds: [] },
    elapsedMs: 0,
  }),
  cancelJob: vi.fn().mockResolvedValue(undefined),
  cancelAllJobs: vi.fn().mockResolvedValue(undefined),
  pruneJobs: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
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
  setPluginTrusted: vi.fn(),
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
    .mockResolvedValue({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  setProjectPreferences: vi
    .fn()
    .mockResolvedValue({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  getProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  setProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  getActiveProvider: vi
    .fn()
    .mockResolvedValue({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
    }),
  setActiveProvider: vi.fn().mockResolvedValue({
    activeProvider: 'markdown',
    detected: [],
    source: 'default' as const,
    selectable: [],
    markerDrift: null,
    switch: { dropped: null },
  }),
  acceptActiveProviderMarkers: vi.fn().mockResolvedValue({
    activeProvider: 'markdown',
    detected: [],
    source: 'default' as const,
    selectable: [],
    markerDrift: null,
  }),
  getActivityInstallStatus: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }),
  installActivityHook: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }),
  uninstallActivityHook: vi.fn().mockResolvedValue({ ...{
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }, removed: false }),
  getAgentSkillInstallStatus: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
  }),
  installAgentSkill: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    outcome: 'installed' as const,
  }),
  uninstallAgentSkill: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    removed: false,
  }),
  getActivitySummary: vi.fn().mockResolvedValue({ since: 0, nodes: {}, pairs: {} }),
  getNodeActivity: vi.fn().mockResolvedValue({
    stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
    recent: [],
    spawns: [],
    captureEnabled: false,
    runs: [],
  }),
  getSpawnRecord: vi.fn().mockResolvedValue(null),
  getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
  setActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
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

describe('GraphView, canvas click deselect shield', () => {
  /**
   * `onCanvasClick` clears the selection UNLESS the click landed inside
   * a surface marked `data-canvas-click-shield` (node cards, palettes,
   * toolbar, inspector panel, perf HUD). The attribute contract
   * replaced a hand-maintained CSS-class selector list, so the thing
   * to pin is the mechanism itself: shielded ancestor -> keep, bare
   * target -> clear.
   */
  it('keeps the selection for shielded targets and clears it on bare canvas', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);
    cmp.selectedNodeId.set('a.md');

    const shielded = document.createElement('div');
    shielded.setAttribute('data-canvas-click-shield', '');
    const inner = document.createElement('span');
    shielded.appendChild(inner);
    cmp.onCanvasClick({ target: inner } as unknown as MouseEvent);
    expect(cmp.selectedNodeId()).toBe('a.md');

    const bare = document.createElement('span');
    cmp.onCanvasClick({ target: bare } as unknown as MouseEvent);
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

describe('GraphView, spawn-edge conversation thread', () => {
  /** Protected-surface probe for the conversation-dialog state. */
  interface IConvoProbe {
    onSpawnEdgeClick(spawnId: string, event: MouseEvent): void;
    conversationOpen(): boolean;
    conversationThread(): ISpawnThread | null;
    conversationCaptureEnabled(): boolean;
  }

  function makeSpawn(
    spawnId: string,
    startedAt: number,
    overrides: Partial<IActivitySpawnRecordApi> = {},
  ): IActivitySpawnRecordApi {
    return {
      spawnId,
      parentOwner: 'main:6cfe5636',
      childKind: 'agent',
      childName: 'demo-worker',
      childNodePath: '.claude/agents/demo-worker.md',
      prompt: `ask ${spawnId}`,
      response: `reply ${spawnId}`,
      startedAt,
      status: 'ended',
      ...overrides,
    };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    // STUB_DATA_SOURCE is module-shared; pin these two mocks back to
    // their neutral defaults so tests do not leak into each other.
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockReset().mockResolvedValue(null);
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockReset().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
  });

  /** Lets the two chained awaits of the click handler settle. */
  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  it('widens the clicked record to the full thread via the two fetches', async () => {
    const s1 = makeSpawn('s1', 1000);
    const s2 = makeSpawn('s2', 2000);
    const s3 = makeSpawn('s3', 3000, { status: 'running', response: undefined });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({ ...s2, captureEnabled: true });
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockResolvedValue({
      stats: { count: 3, lastStartAt: 3000, distinctOwners: 1 },
      recent: [],
      spawns: [s3, s1, s2],
      captureEnabled: true,
      runs: [],
    });

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s2', new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).toHaveBeenCalledWith('s2');
    expect(STUB_DATA_SOURCE.getNodeActivity).toHaveBeenCalledWith('.claude/agents/demo-worker.md');
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s1', 's2', 's3']);
  });

  it('falls back to a singleton thread when the widening fetch fails', async () => {
    const s2 = makeSpawn('s2', 2000);
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({ ...s2, captureEnabled: true });
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockRejectedValue(new Error('transport down'));

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s2', new MouseEvent('click'));
    await settle();

    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s2']);
  });

  it('skips the widening fetch when the record names no scanned child', async () => {
    const record = makeSpawn('s5', 5000, { childNodePath: undefined });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({
      ...record,
      captureEnabled: false,
    });

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s5', new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getNodeActivity).not.toHaveBeenCalled();
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(false);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s5']);
  });

  it('a superseding second click drops the stale first fetch', async () => {
    let resolveFirst!: (value: IActivitySpawnDetailApi | null) => void;
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord)
      .mockImplementationOnce(
        () =>
          new Promise<IActivitySpawnDetailApi | null>((res) => {
            resolveFirst = res;
          }),
      )
      .mockImplementationOnce(async () => ({
        ...makeSpawn('s9', 9000, { childNodePath: undefined, childName: 'other-agent' }),
        captureEnabled: false,
      }));

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s1', new MouseEvent('click'));
    probe.onSpawnEdgeClick('s9', new MouseEvent('click'));
    await settle();

    // The stale first record lands AFTER the second click resolved.
    resolveFirst({ ...makeSpawn('s1', 1000), captureEnabled: true });
    await settle();

    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s9']);
  });
});

describe('GraphView, spawn-active static edges', () => {
  interface IStaticEdgeProbe {
    onStaticEdgeClick(
      edge: { id: string; from: string; to: string },
      event: MouseEvent,
    ): void;
    spawnActiveIdFor(edge: { from: string; to: string }): string | null;
    conversationOpen(): boolean;
    conversationThread(): ISpawnThread | null;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockReset().mockResolvedValue(null);
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockReset().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
  });

  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  it('routes a spawn-active static edge click into the SAME conversation path as the dashed edge', async () => {
    const record: IActivitySpawnRecordApi = {
      spawnId: 's7',
      parentOwner: 'main:6cfe5636',
      parentNodePath: 'agents/orchestrator.md',
      childName: 'demo-worker',
      startedAt: 7000,
      status: 'running',
      prompt: 'go',
    };
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({
      ...record,
      captureEnabled: true,
    });

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IStaticEdgeProbe;
    // Pin the pair lookup: the overlay -> pairKey mapping is pure and
    // covered by spawn-overlay.spec; this test owns the click routing.
    (probe as { spawnActiveIdFor(edge: unknown): string | null }).spawnActiveIdFor = () => 's7';

    probe.onStaticEdgeClick(
      { id: 'e1', from: 'agents/orchestrator.md', to: 'agents/worker.md' },
      new MouseEvent('click'),
    );
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).toHaveBeenCalledWith('s7');
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s7']);
  });

  it('a label-less static edge click does nothing (no fetch, no dialog)', async () => {
    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IStaticEdgeProbe;

    // Real lookups: no live spawns and no pair counters, so every
    // static edge is plain AND label-less, and the click stays inert.
    expect(
      probe.spawnActiveIdFor({ from: 'agents/orchestrator.md', to: 'agents/worker.md' }),
    ).toBeNull();
    probe.onStaticEdgeClick(
      { id: 'e1', from: 'agents/orchestrator.md', to: 'agents/worker.md' },
      new MouseEvent('click'),
    );
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).not.toHaveBeenCalled();
    expect(STUB_DATA_SOURCE.getNodeActivity).not.toHaveBeenCalled();
    expect(probe.conversationOpen()).toBe(false);
  });
});

describe('GraphView, follow-the-activity camera', () => {
  const FOLLOW_KEY = 'sm.live.follow-activity';

  /** Protected-surface probe for the follow feature. The fingerprint /
   *  framing internals moved to `follow-activity.controller.ts` and are
   *  covered by `follow-activity.controller.spec.ts`; this suite keeps
   *  the component-level wiring (toggle, gesture disable, boot gating). */
  interface IFollowProbe {
    followActivity(): boolean;
    toggleFollowActivity(): void;
    onCanvasChange(event: { position: { x: number; y: number }; scale: number }): void;
    fitToScreen(): void;
    zoomIn(): void;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(FOLLOW_KEY);
    localStorage.removeItem('sm.map.visible-paths');
    localStorage.removeItem('sm.graph.viewport');
  });

  /**
   * Local bootstrap: same harness as the shared `bootstrap()` plus a
   * stubbed `NodeActivityService` whose `activePaths` / `enabled`
   * signals the test drives directly (the real service only moves on
   * WS frames, which demo mode never opens).
   */
  async function bootstrapWithActivity(
    initialNodes: INodeView[],
    active: ReturnType<typeof signal<ReadonlySet<string>>>,
    activityEnabled: ReturnType<typeof signal<boolean>>,
  ): Promise<{ fixture: ComponentFixture<GraphView>; cmp: GraphView; probe: IFollowProbe }> {
    const loader = makeStubLoader(initialNodes);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: BlankPage }]),
        { provide: CollectionLoaderService, useValue: loader },
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
        {
          provide: NodeActivityService,
          useValue: {
            enabled: activityEnabled.asReadonly(),
            activePaths: active.asReadonly(),
            activeInvocations: signal<readonly INodeInvocation[]>([]).asReadonly(),
            setEnabled: vi.fn(),
          } as unknown as NodeActivityService,
        },
      ],
    });
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
    TestBed.inject(KindRegistryService).ingest({
      agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const fixture = TestBed.createComponent(GraphView);
    return {
      fixture,
      cmp: fixture.componentInstance,
      probe: fixture.componentInstance as unknown as IFollowProbe,
    };
  }

  /** Flush effects + the boot-fit `queueMicrotask` + the follow effect re-run. */
  async function settleBoot(fixture: ComponentFixture<GraphView>): Promise<void> {
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    await flushEffects(fixture);
  }

  it('toggle flips the persisted preference through LivePreferencesService', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    expect(probe.followActivity()).toBe(false);
    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);
    expect(TestBed.inject(LivePreferencesService).followActivityEnabled()).toBe(true);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('true');

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(false);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('false');
  });

  it('a canvas gesture while the camera RESTS keeps follow armed', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);

    // Foblex only emits fCanvasChange for user gestures; simulate one
    // with no camera tween in flight: looking around between
    // executions must not disarm the follow preference.
    probe.onCanvasChange({ position: { x: 5, y: 5 }, scale: 1 });
    expect(probe.followActivity()).toBe(true);
  });

  it('a canvas gesture that interrupts an in-flight camera move switches follow off', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, cmp, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);

    // Drive the shared tween entry point directly (the follow effect
    // reaches it through dagre positions, unavailable under jsdom) so
    // the camera counts as moving, then interrupt it with a gesture.
    (cmp as unknown as {
      animateToTransform(t: { position: { x: number; y: number }; scale: number }): void;
    }).animateToTransform({ position: { x: 100, y: 100 }, scale: 1 });
    probe.onCanvasChange({ position: { x: 5, y: 5 }, scale: 1 });
    expect(probe.followActivity()).toBe(false);
  });

  it('canvas events during boot do NOT kill a persisted follow preference', async () => {
    localStorage.setItem(FOLLOW_KEY, 'true');
    const active = signal<ReadonlySet<string>>(new Set());
    // Empty node set: `visibleNodes` stays empty, the boot fit never
    // completes, so the boot-time imperative fit's own emission must
    // leave the preference alone.
    const { fixture, probe } = await bootstrapWithActivity([], active, signal(true));
    await settleBoot(fixture);

    expect(probe.followActivity()).toBe(true);
    probe.onCanvasChange({ position: { x: 5, y: 5 }, scale: 1 });
    expect(probe.followActivity()).toBe(true);
  });

  it('an animated camera move persists the destination viewport for reload', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, cmp } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    // Nothing persisted from boot (beforeEach cleared the key; the boot
    // fit is suppressed only when a saved viewport exists, and there is
    // none here, so the boot writes come from the fit itself). Drive the
    // shared tween entry point like a toolbox tool would (fit / reset /
    // show-all / isolate all funnel through it), then assert the target
    // landed in localStorage so an F5 restores it instead of the
    // pre-click position.
    (cmp as unknown as {
      animateToTransform(t: { position: { x: number; y: number }; scale: number }): void;
    }).animateToTransform({ position: { x: 100, y: 240 }, scale: 1.5 });

    const raw = localStorage.getItem('sm.graph.viewport');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ x: 100, y: 240, scale: 1.5 });
  });

  it('toolbar camera buttons (fit / zoom) keep follow armed', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);
    // Neither fit-to-screen nor zoom hand control back anymore: the
    // camera repositions now and follow re-grabs it on the next activity
    // change (the operator only turns follow off via its own toggle).
    probe.fitToScreen();
    expect(probe.followActivity()).toBe(true);
    probe.zoomIn();
    expect(probe.followActivity()).toBe(true);
  });

  // Fingerprint semantics (visible-only membership, sort-insensitivity,
  // empty-set sentinel) and the re-frame cadence are covered by
  // `follow-activity.controller.spec.ts` against the extracted
  // controller's observable surface.
});

describe('GraphView, edge conversation-count labels + historical click', () => {
  const PARENT = 'agents/orchestrator.md';
  const CHILD = 'agents/worker.md';
  const PAIR_KEY = `${PARENT}>>${CHILD}`;
  const EDGE = { id: 'e1', from: PARENT, to: CHILD };

  /** Protected-surface probe for the count lookups + historical path. */
  interface IConvoCountProbe {
    convoCountFor(edge: { from: string; to: string }): number;
    convoCountForKey(pairKey: string): number;
    spawnActiveIdFor(edge: { from: string; to: string }): string | null;
    onStaticEdgeClick(edge: { id: string; from: string; to: string }, event: MouseEvent): void;
    conversationOpen(): boolean;
    conversationThread(): ISpawnThread | null;
    conversationCaptureEnabled(): boolean;
  }

  function makeHistoricalRecord(
    spawnId: string,
    startedAt: number,
    overrides: Partial<IActivitySpawnRecordApi> = {},
  ): IActivitySpawnRecordApi {
    return {
      spawnId,
      parentOwner: 'main:6cfe5636',
      parentNodePath: PARENT,
      childKind: 'agent',
      childName: 'worker',
      childNodePath: CHILD,
      prompt: `ask ${spawnId}`,
      response: `reply ${spawnId}`,
      startedAt,
      status: 'ended',
      ...overrides,
    };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    // The REAL NodeActivityStatsService hydrates pairCounts from the
    // summary; each test seeds the mock BEFORE bootstrap.
    vi.mocked(STUB_DATA_SOURCE.getActivitySummary)
      .mockReset()
      .mockResolvedValue({ since: 0, nodes: {}, pairs: {} });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockReset().mockResolvedValue(null);
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockReset().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
  });

  function seedPairs(pairs: Record<string, { count: number; lastStartAt: number }>): void {
    vi.mocked(STUB_DATA_SOURCE.getActivitySummary).mockResolvedValue({
      since: 0,
      nodes: {},
      pairs,
    });
  }

  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  it('exposes the hydrated pair count for a static edge and via the key form (dashed edges)', async () => {
    seedPairs({ [PAIR_KEY]: { count: 3, lastStartAt: 1000 } });
    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;

    // Static edges (plain AND spawn-active) resolve through the edge
    // form; the dashed spawn edges use the precomputed key form
    // (session parents key by the raw owner).
    expect(probe.convoCountFor(EDGE)).toBe(3);
    expect(probe.convoCountForKey(PAIR_KEY)).toBe(3);
    expect(probe.convoCountForKey(`main:6cfe5636>>${CHILD}`)).toBe(0);
    expect(probe.convoCountFor({ from: CHILD, to: PARENT })).toBe(0); // directional
  });

  it('historical click opens the MOST RECENT thread of the pair, filtered to this parent', async () => {
    seedPairs({ [PAIR_KEY]: { count: 3, lastStartAt: 3000 } });
    // Two sessions talked over this edge (two threads); a foreign
    // parent's record must not leak into either.
    const oldTurn = makeHistoricalRecord('h0', 500, { parentOwner: 'main:older' });
    const t1 = makeHistoricalRecord('h1', 1000);
    const t2 = makeHistoricalRecord('h2', 2000);
    const foreign = makeHistoricalRecord('x1', 3000, { parentNodePath: 'agents/other.md' });
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockResolvedValue({
      stats: { count: 3, lastStartAt: 3000, distinctOwners: 2 },
      recent: [],
      spawns: [oldTurn, t1, t2, foreign],
      captureEnabled: true,
      runs: [],
    });

    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;
    probe.onStaticEdgeClick(EDGE, new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getNodeActivity).toHaveBeenCalledWith(CHILD);
    expect(STUB_DATA_SOURCE.getSpawnRecord).not.toHaveBeenCalled();
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(true);
    // Most recent thread (the main:6cfe5636 session) wins; its records
    // are chronological and the foreign parent is filtered out.
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['h1', 'h2']);
  });

  it('historical click with nothing retained opens the empty-records thread carrying the pair naming', async () => {
    seedPairs({ [PAIR_KEY]: { count: 2, lastStartAt: 2000 } });
    // Capture gate off / server restarted: detail comes back empty.
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });

    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;
    probe.onStaticEdgeClick(EDGE, new MouseEvent('click'));
    await settle();

    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(false);
    const thread = probe.conversationThread();
    expect(thread?.records).toEqual([]);
    expect(thread?.parentNodePath).toBe(PARENT);
    expect(thread?.childNodePath).toBe(CHILD);
  });

  it('a live spawn riding the edge still wins over the historical path', async () => {
    seedPairs({ [PAIR_KEY]: { count: 5, lastStartAt: 5000 } });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({
      ...makeHistoricalRecord('s7', 7000, { status: 'running', response: undefined }),
      captureEnabled: true,
    });

    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;
    // Pin the pair lookup (overlay -> pairKey mapping is covered by
    // spawn-overlay.spec); the count is ALSO > 0, live must win.
    (probe as { spawnActiveIdFor(edge: unknown): string | null }).spawnActiveIdFor = () => 's7';

    probe.onStaticEdgeClick(EDGE, new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).toHaveBeenCalledWith('s7');
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s7']);
  });
});
