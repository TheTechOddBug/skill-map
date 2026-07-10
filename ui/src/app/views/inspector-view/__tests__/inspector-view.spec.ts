import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { EMPTY, Subject } from 'rxjs';

import { InspectorView } from '../inspector-view';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { LivePreferencesService } from '../../../../services/live-preferences';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import type { INodeView, ISidecarOverlay } from '../../../../models/node';
import { activityPairKeyOf } from '../../../../models/api';
import type { INodeDetailApi, INodeApi, INodeActivityStatsApi } from '../../../../models/api';
import type { ISpawnThread } from '../../../components/conversation-dialog/spawn-thread';

/**
 * Inspector view spec, Step 14.5.a body card lifecycle, annotations,
 * the generic action-button toolbar (contribution-driven, the bump
 * button is no longer hardcoded), and the catalog curation 2026-05-07
 * surfaces (collapsible audit / plugin / debug; vendor frontmatter
 * tier card).
 */

// Section collapse state persists in localStorage; clear it before each
// test so collapse defaults are deterministic (everything collapsed by
// default EXCEPT body + findings) and tests do not leak state into each
// other.
beforeEach(() => {
  localStorage.clear();
});

type IStubDataSource = IDataSourcePort & {
  getNode: ReturnType<typeof vi.fn>;
  getNodeActivity: ReturnType<typeof vi.fn>;
};

type IStubLoader = {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  scanMeta: ReturnType<typeof signal<unknown>>;
  loading: ReturnType<typeof signal<boolean>>;
  load: ReturnType<typeof vi.fn>;
};

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'The architect.',
      metadata: { version: '1.0.0' },
    },
    ...overrides,
  };
}

function makeApiNode(overrides: Partial<INodeApi> = {}): INodeApi {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'h',
    frontmatterHash: 'fh',
    bytes: { frontmatter: 10, body: 20, total: 30 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
}

function makeDetail(item: INodeApi): INodeDetailApi {
  return {
    schemaVersion: '1',
    kind: 'node',
    item,
    links: { incoming: [], outgoing: [] },
    issues: [],
    kindRegistry: {},
  };
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  return {
    nodes: signal(initialNodes),
    // The inspector's ngOnInit boot guard reads `scanMeta()`; a non-null
    // value keeps it from kicking a (stubbed) `load()` under test.
    scanMeta: signal<unknown>({}),
    loading: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStubDataSource(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    listLinks: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'links',
      items: [],
      filters: { kind: null, from: null, to: null },
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
    listIssues: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'issues',
      items: [],
      filters: { severity: null, analyzerId: null, node: null },
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
    getNodeActivity: vi.fn().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
    }),
    bumpSidecar: vi.fn(),
    dispatchAction: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'action.applied',
      value: { actionId: 'core/node-bump', nodePath: '' },
      elapsedMs: 1,
    }),
    getUpdateStatus: vi.fn().mockResolvedValue({
      current: '0.0.0',
      latest: null,
      isOutdated: false,
      checkedAt: null,
      shownAt: null,
    }),
    getRegisteredAnnotations: vi.fn().mockResolvedValue([]),
    events: vi.fn().mockReturnValue(EMPTY),
  } as unknown as IStubDataSource;
}

class FakeMarkdownRenderer extends MarkdownRenderer {
  constructor(
    private readonly sanitizerRef: DomSanitizer,
    private readonly mode: 'pass' | 'throw',
  ) {
    super();
  }

  override async render(src: string): Promise<SafeHtml> {
    if (this.mode === 'throw') throw new Error('boom');
    return this.sanitizerRef.bypassSecurityTrustHtml(`<div data-fake>${src}</div>`);
  }

  // Raw-view highlighter stub: wrap the source verbatim so tests can assert
  // on its text without loading the real highlight.js chunk in jsdom.
  override async highlightSource(src: string): Promise<SafeHtml> {
    if (this.mode === 'throw') throw new Error('boom');
    return this.sanitizerRef.bypassSecurityTrustHtml(`<span data-fake-raw>${src}</span>`);
  }
}

interface IBootstrapOpts {
  loader?: IStubLoader;
  dataSource?: IStubDataSource;
  rendererMode?: 'pass' | 'throw';
  /** Drives the body card's reactive `scan.completed` refresh. */
  scanCompleted$?: Subject<void>;
  /** Drives the Activity section's live `node.activity` re-fetch. */
  nodeActivity$?: Subject<void>;
  /** Drives the Activity section's live `agent.spawn` re-fetch. */
  agentSpawn$?: Subject<void>;
  /** Seeds the per-node stats mirror that gates the Activity section. */
  activityStats?: ReadonlyMap<string, INodeActivityStatsApi>;
  /** Seeds the per-pair spawn counters (Activity gate, spawn side). */
  activityPairs?: ReadonlyMap<string, number>;
  /** Real-time activity preference (default ON, like the app). */
  activityEnabled?: boolean;
}

/** Stats entry seed for the Activity visibility gate. */
function makeActivityStats(overrides: Partial<INodeActivityStatsApi> = {}): INodeActivityStatsApi {
  return { count: 1, lastStartAt: 1000, distinctOwners: 1, ...overrides };
}

function bootstrap(opts: IBootstrapOpts = {}): {
  fixture: ComponentFixture<InspectorView>;
  cmp: InspectorView;
  loader: IStubLoader;
  dataSource: IStubDataSource;
  scanCompleted$: Subject<void>;
  nodeActivity$: Subject<void>;
  agentSpawn$: Subject<void>;
} {
  const loader = opts.loader ?? makeStubLoader();
  const dataSource = opts.dataSource ?? makeStubDataSource();
  const scanCompleted$ = opts.scanCompleted$ ?? new Subject<void>();
  const nodeActivity$ = opts.nodeActivity$ ?? new Subject<void>();
  const agentSpawn$ = opts.agentSpawn$ ?? new Subject<void>();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: DATA_SOURCE, useValue: dataSource },
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
      { provide: CollectionLoaderService, useValue: loader },
      // Stub the WS stream: the body card subscribes to `scanCompleted$`
      // for its reactive refresh. A Subject lets tests drive it; the
      // other streams are unused here so they resolve to EMPTY.
      {
        provide: WsEventStreamService,
        useValue: {
          scanCompleted$: scanCompleted$.asObservable(),
          events$: EMPTY,
          sidecarBumped$: EMPTY,
          // The Activity section's live re-fetch merges these two streams;
          // Subjects let tests drive `node.activity` and `agent.spawn` frames.
          nodeActivity$: nodeActivity$.asObservable(),
          agentSpawn$: agentSpawn$.asObservable(),
        } as unknown as WsEventStreamService,
      },
      {
        provide: MarkdownRenderer,
        useFactory: (): MarkdownRenderer =>
          new FakeMarkdownRenderer(TestBed.inject(DomSanitizer), opts.rendererMode ?? 'pass'),
      },
      // The Activity section's visibility gate reads the per-node stats
      // mirror; the real service subscribes to WS streams the stub above
      // does not expose, so tests seed plain signal maps instead.
      {
        provide: NodeActivityStatsService,
        useValue: {
          stats: signal<ReadonlyMap<string, INodeActivityStatsApi>>(
            opts.activityStats ?? new Map(),
          ),
          pairCounts: signal<ReadonlyMap<string, number>>(opts.activityPairs ?? new Map()),
        } as unknown as NodeActivityStatsService,
      },
      {
        provide: LivePreferencesService,
        useValue: {
          activityEnabled: signal(opts.activityEnabled ?? true),
        } as unknown as LivePreferencesService,
      },
    ],
  });
  const fixture = TestBed.createComponent(InspectorView);
  return {
    fixture,
    cmp: fixture.componentInstance,
    loader,
    dataSource,
    scanCompleted$,
    nodeActivity$,
    agentSpawn$,
  };
}

async function flush(fixture: ComponentFixture<InspectorView>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('InspectorView, conversation dialog (no-fetch openThread path)', () => {
  it('hands the clicked thread to the shared controller without fetching', async () => {
    const { fixture, cmp, dataSource } = bootstrap();
    await flush(fixture);

    const probe = cmp as unknown as {
      openSpawnConversation(thread: ISpawnThread): void;
      onConversationClosed(): void;
      conversationOpen(): boolean;
      conversationThread(): ISpawnThread | null;
    };
    const thread: ISpawnThread = {
      key: 'main:1|agents/worker.md',
      parentOwner: 'main:1',
      parentNodePath: 'agents/orchestrator.md',
      childNodePath: 'agents/worker.md',
      records: [],
    };

    expect(probe.conversationOpen()).toBe(false);
    probe.openSpawnConversation(thread);
    expect(probe.conversationOpen()).toBe(true);
    // Handed over verbatim: the inspector already holds the records,
    // so the controller's fetch paths (openSpawn / openHistorical)
    // must stay untouched on this surface.
    expect(probe.conversationThread()).toBe(thread);
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();

    probe.onConversationClosed();
    expect(probe.conversationOpen()).toBe(false);
  });
});

describe('InspectorView, empty states', () => {
  it('renders the no-selection empty state when path is undefined', async () => {
    const { fixture } = bootstrap();
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-no-selection"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('renders the not-found empty state when the path is not in nodes()', async () => {
    const { fixture } = bootstrap();
    fixture.componentRef.setInput('path', 'agents/missing.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-not-found"]')).not.toBeNull();
  });
});

describe('InspectorView, body card lifecycle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the loading state while getNode() is in flight', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockReturnValue(new Promise(() => {}));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-loading"]')).not.toBeNull();
    expect(dataSource.getNode).toHaveBeenCalledWith(node.path, { includeBody: true });
  });

  it('renders the markdown HTML when getNode() returns a body', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# hello\n\nworld.' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# hello');
    expect(rendered!.innerHTML).toContain('data-fake');
  });

  it('hides the body section when item.body is undefined (empty)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode()));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    // Nothing to render -> the whole Body section is omitted (no empty
    // placeholder).
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when item.body is null (file missing)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: null })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when getNode() returns null (404)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(null);

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when getNode() throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockRejectedValue(new Error('network down'));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when the markdown renderer throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# trips it' })));

    const { fixture } = bootstrap({ loader, dataSource, rendererMode: 'throw' });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('drops a stale resolution when the user navigates to a different path mid-fetch', async () => {
    const nodeA = makeNode({ path: 'a.md', frontmatter: { name: 'A', description: '', metadata: { version: '' } } });
    const nodeB = makeNode({ path: 'b.md', frontmatter: { name: 'B', description: '', metadata: { version: '' } } });
    const loader = makeStubLoader([nodeA, nodeB]);
    const dataSource = makeStubDataSource();

    let resolveA!: (v: INodeDetailApi) => void;
    const pendingA = new Promise<INodeDetailApi>((res) => {
      resolveA = res;
    });
    dataSource.getNode.mockImplementation((p: string) => {
      if (p === 'a.md') return pendingA;
      return Promise.resolve(makeDetail(makeApiNode({ path: 'b.md', body: '# B body' })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    fixture.componentRef.setInput('path', 'b.md');
    await flush(fixture);

    resolveA(makeDetail(makeApiNode({ path: 'a.md', body: '# A body, late' })));
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# B body');
    expect(rendered!.innerHTML).not.toContain('A body');
  });

  it('re-fetches and re-renders the body on a scan.completed event (reactive refresh)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# first' })));

    const { fixture, scanCompleted$ } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-body-rendered"]')!.innerHTML,
    ).toContain('# first');
    // Multiple consumers call getNode on selection (body card + the
    // linked-nodes panel), so assert the call count GROWS after the
    // event rather than pinning an exact number; the body content swap
    // below is the real proof of the reactive re-render.
    const callsBeforeEvent = dataSource.getNode.mock.calls.length;

    // The file body changes on disk and the watcher re-scans: getNode now
    // returns the new body, and the scan.completed event triggers a silent
    // re-fetch for the SAME path (no navigation, no path-signal change).
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# second' })));
    scanCompleted$.next();
    await flush(fixture);

    expect(dataSource.getNode.mock.calls.length).toBeGreaterThan(callsBeforeEvent);
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered!.innerHTML).toContain('# second');
    expect(rendered!.innerHTML).not.toContain('# first');
  });

  it('ignores scan.completed when no node is selected (no fetch)', async () => {
    const dataSource = makeStubDataSource();
    const { fixture, scanCompleted$ } = bootstrap({ dataSource });
    await flush(fixture);

    scanCompleted$.next();
    await flush(fixture);

    expect(dataSource.getNode).not.toHaveBeenCalled();
  });
});

describe('InspectorView, body raw / rendered toggle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderBody(body: string): Promise<ComponentFixture<InspectorView>> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    return fixture;
  }

  it('defaults to the rendered view and shows the toggle when the body is ready', async () => {
    const dom = (await renderBody('# hello\n\nworld')).nativeElement as HTMLElement;
    expect(dom.querySelector('[data-testid="inspector-body-view-toggle"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-raw"]')).toBeNull();
  });

  it('swaps to the raw source on toggle and back to rendered on a second click', async () => {
    const fixture = await renderBody('# hello\n\nworld');
    const dom = fixture.nativeElement as HTMLElement;

    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    const raw = dom.querySelector('[data-testid="inspector-body-raw"]');
    expect(raw).not.toBeNull();
    // The raw view shows the source verbatim (the `#` markdown is NOT rendered).
    expect(raw!.textContent).toContain('# hello');
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).toBeNull();

    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-raw"]')).toBeNull();
  });

  it('renders the raw view as a line-numbered, highlighted editor', async () => {
    const fixture = await renderBody('# title\nbody line');
    const dom = fixture.nativeElement as HTMLElement;
    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);

    // Gutter: one number per source line.
    const gutter = dom.querySelector('.inspector__body-raw-gutter');
    expect(gutter).not.toBeNull();
    expect(gutter!.textContent).toBe('1\n2');

    // Code: the highlight.js container, source text intact.
    const code = dom.querySelector('[data-testid="inspector-body-raw-code"]');
    expect(code).not.toBeNull();
    expect(code!.classList.contains('hljs')).toBe(true);
    expect(code!.textContent).toContain('# title');
  });
});

describe('InspectorView, codex / bodyField inline body', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function makeCodexNode(developerInstructions: string | undefined): INodeView {
    const frontmatter: Record<string, unknown> = {
      name: 'architect',
      description: 'd',
      model: 'gpt-5-codex',
      sandbox_mode: 'read-only',
    };
    if (developerInstructions !== undefined) {
      frontmatter['developer_instructions'] = developerInstructions;
    }
    return makeNode({
      path: '.codex/agents/architect.toml',
      kind: 'agent',
      provider: 'codex',
      frontmatter: frontmatter as unknown as INodeView['frontmatter'],
    });
  }

  /** Seed the provider registry with a codex entry declaring its bodyField. */
  function seedCodexRegistry(): void {
    TestBed.inject(ProviderRegistryService).ingest({
      codex: {
        label: 'OpenAI Codex',
        color: '#22c55e',
        isLens: true,
        bodyField: 'developer_instructions',
      },
    });
  }

  it('renders developer_instructions as the body and never asks the BFF for the raw file', async () => {
    const node = makeCodexNode('# Codex prompt\n\nbody from the TOML field');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // If the body card ever hit the disk-read path it would render this raw
    // TOML stand-in; the inline path must win.
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# Codex prompt');
    expect(rendered!.innerHTML).not.toContain('RAW TOML');
    // The body card never requests the on-demand disk read for a bodyField
    // provider (other panels may call getNode, but not with includeBody).
    expect(dataSource.getNode).not.toHaveBeenCalledWith(node.path, { includeBody: true });
  });

  it('renders a codex skill (.md, no developer_instructions) from its fetched markdown body', async () => {
    // Regression: the codex Provider declares `bodyField: developer_instructions`
    // for its `.toml` agents, but its open-standard `.agents/skills/*/SKILL.md`
    // skills (same provider id) have no such field. They must fall back to the
    // normal body fetch, not render an empty (hidden) Body section.
    const node = makeNode({
      path: '.agents/skills/run-tests/SKILL.md',
      kind: 'skill',
      provider: 'codex',
      frontmatter: { name: 'run-tests', description: 'd' } as unknown as INodeView['frontmatter'],
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', kind: 'skill', body: '# Run tests\n\nDo it.' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# Run tests');
    // A skill with no bodyField value pulls its body from the disk fetch.
    expect(dataSource.getNode).toHaveBeenCalledWith(node.path, { includeBody: true });
  });

  it('shows the raw developer_instructions verbatim when toggled to the raw view', async () => {
    const node = makeCodexNode('# Codex prompt\n\nbody from the TOML field');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    const raw = dom.querySelector('[data-testid="inspector-body-raw"]');
    expect(raw).not.toBeNull();
    // The raw view is the developer_instructions source, not the BFF's raw TOML.
    expect(raw!.textContent).toContain('# Codex prompt');
    expect(raw!.textContent).not.toContain('RAW TOML');
  });

  it('hides the body section for a codex node with an empty developer_instructions (no disk fallback)', async () => {
    const node = makeCodexNode('');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    // Empty effective body -> the whole section is omitted, and we never
    // fall back to the disk read (which would hand back raw TOML).
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
    expect(dataSource.getNode).not.toHaveBeenCalledWith(node.path, { includeBody: true });
  });
});

describe('InspectorView, vendor frontmatter card (catalog curation)', () => {
  it('renders the vendor frontmatter card on every kind that has a vendor surface', async () => {
    const node = makeNode({
      kind: 'agent',
      frontmatter: {
        name: 'architect',
        description: 'd',
        model: 'opus',
        metadata: { version: '1.0.0' },
      } as INodeView['frontmatter'],
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-vendor-frontmatter"]')).not.toBeNull();
  });
});

// Smoke: confirm the router is reachable so node-open navigation
// (via NODE_OPEN_INTENT's default Router-backed implementation) wires up.
describe('InspectorView, router smoke', () => {
  it('has a router available for in-app navigation links', () => {
    bootstrap();
    expect(TestBed.inject(Router)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Action toolbar (contribution-driven) + annotations panel
// ---------------------------------------------------------------------------

function makeNodeWithSidecar(overlay: ISidecarOverlay | undefined): INodeView {
  const view: INodeView = {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'd',
      metadata: { version: '1' },
    },
  };
  if (overlay) view.sidecar = overlay;
  return view;
}

describe('InspectorView, actions section (contribution-driven)', () => {
  it('renders the Actions section hosting the inspector.action.button slot when the node has action contributions', async () => {
    const node: INodeView = {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: { name: 'architect', description: 'd', metadata: { version: '1' } },
      contributions: [
        {
          pluginId: 'core',
          extensionId: 'node-set-stability',
          nodePath: 'agents/architect.md',
          contributionId: 'setStabilityButton',
          slot: 'inspector.action.button',
          payload: { actionId: 'core/node-set-stability', label: 'Set stability', enabled: true },
        },
      ],
    };
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const section = dom.querySelector('[data-testid="inspector-card-actions"]');
    expect(section).not.toBeNull();
    // The slot host is mounted inside the (default-expanded) section.
    expect(section!.querySelector('sm-view-contributions-host')).not.toBeNull();
    // No hardcoded bump button; it arrives as a contribution.
    expect(dom.querySelector('[data-testid="inspector-bump"]')).toBeNull();
  });

  it('does NOT render the Actions section when the node has no action contributions', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-actions"]')).toBeNull();
  });

  it('renders the consent dialog component (driven by the dispatch service)', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // The standalone dialog component is mounted in the template; its
    // inner `<p-dialog>` stays hidden (open=false) until a dispatch hits
    // the consent gate, so we assert on the component host element.
    expect(fixture.nativeElement.querySelector('sm-sidecar-consent-dialog')).not.toBeNull();
  });
});

describe('InspectorView, annotations card (Step 9.6.5)', () => {
  it('does NOT render the annotations card when no sidecar overlay is present', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).toBeNull();
  });

  it('renders the annotations card when the sidecar carries renderable annotations', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { source: 'https://example.com/repo' },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).not.toBeNull();
  });

  it('does NOT render the annotations card when the sidecar is present but has no renderable annotations', async () => {
    // version / stability are node properties shown elsewhere, not in the
    // annotations panel (which renders provenance / repository / docs), so
    // a sidecar carrying only those has nothing to show and the section is
    // hidden entirely instead of rendering an empty panel.
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 3, stability: 'stable' },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Catalog curation 2026-05-07, collapsibles + debug toggle + banner
// ---------------------------------------------------------------------------

describe('InspectorView, collapsible sections (catalog curation)', () => {
  async function renderInspector(overlay?: ISidecarOverlay): Promise<HTMLElement> {
    const node = makeNodeWithSidecar(overlay);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the metadata section collapsed by default', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // The section renders (the node has a sidecar), but collapsed: its
    // body (the audit panel) is NOT in the DOM until the user expands it.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-metadata"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).toBeNull();
  });

  it('expands the metadata section on header click', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Collapsed by default: the audit-panel-empty body is absent.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    await flush(fixture);
    // After expanding, the body appears in the DOM.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).not.toBeNull();
  });

  it('does NOT render the plugin contributions section when sidecar has no non-reserved keys', async () => {
    const dom = await renderInspector();
    // The card chrome only renders when the sidecar carries at least
    // one non-reserved root key (catalog curation, empty cards were
    // painting blank borders on plain nodes).
    expect(dom.querySelector('[data-testid="inspector-card-plugins"]')).toBeNull();
  });

  it('renders the plugin contributions section when sidecar root carries a non-reserved key', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: {},
      root: { 'my-plugin': { foo: 1 } },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-plugins"]'),
    ).not.toBeNull();
    // Collapsed by default, so the namespace block is not rendered until
    // the user expands the section.
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-ns-my-plugin"]'),
    ).toBeNull();
  });

  it('persists a section collapse to localStorage', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // Body must have content so the (default-expanded) body section
    // renders and its toggle is present to click.
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# body' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-toggle"]',
    ) as HTMLButtonElement;
    // Body defaults to expanded, so the first toggle collapses it.
    toggle.click();
    await flush(fixture);
    const stored = JSON.parse(
      localStorage.getItem('skill-map.ui.inspector.sections') ?? '{}',
    ) as Record<string, boolean>;
    expect(stored['body']).toBe(false);
  });
});

describe('InspectorView, debug panel inside the merged metadata section', () => {
  it('renders the debug panel inside the metadata section when expanded', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Metadata is collapsed by default, so the debug panel starts hidden.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-metadata-section"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).not.toBeNull();
  });

  it('does not render the metadata section for a node without a sidecar', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // No sidecar -> the metadata section (and the debug panel it hosts)
    // is omitted entirely.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-metadata"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
  });

  it('toggles the audit + debug panels on metadata expand/collapse', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    // Collapsed by default.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
    toggle.click(); // expand
    await flush(fixture);
    // Both sub-panels appear: the audit empty-state and the debug grid.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).not.toBeNull();
    toggle.click(); // collapse again
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
  });
});

describe('InspectorView, activity section visibility gate', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('hides the section entirely for a node with no recorded activity', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).toBeNull();
  });

  it('does not fetch the detail for a hidden section even with a persisted-open state', async () => {
    localStorage.setItem('skill-map.ui.inspector.sections', JSON.stringify({ activity: true }));
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();
  });

  it('shows the section when the stats mirror carries the node', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('shows the section when a spawn pair touches the node as child', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityPairs: new Map([[activityPairKeyOf('main:6cfe5636', node.path), 2]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('keeps the section available while real-time activity is OFF (mirror unknowable)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource, activityEnabled: false });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });
});

describe('InspectorView, activity thread rows (spawn grouping)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function makeSpawn(spawnId: string, startedAt: number, status: string): Record<string, unknown> {
    return {
      spawnId,
      parentOwner: 'main:6cfe5636',
      childKind: 'agent',
      childName: 'demo-worker',
      childNodePath: '.claude/agents/demo-worker.md',
      prompt: `ask ${spawnId}`,
      response: `reply ${spawnId}`,
      startedAt,
      status,
    };
  }

  it('groups 3 spawn records of the same pair into ONE thread row with "3 exchanges"', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 3, lastStartAt: 3000, distinctOwners: 1 },
      recent: [],
      spawns: [makeSpawn('s2', 2000, 'ended'), makeSpawn('s1', 1000, 'ended'), makeSpawn('s3', 3000, 'running')],
      captureEnabled: true,
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 3, lastStartAt: 3000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    // Activity is collapsed by default; expand it to trigger the fetch.
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-thread"]',
    );
    expect(rows.length).toBe(1);
    // Child name + exchange counter + status of the LAST turn.
    expect(rows[0]!.textContent).toContain('demo-worker');
    expect(rows[0]!.textContent).toContain('3 exchanges');
    expect(rows[0]!.textContent).toContain('running');
    // One View-conversation button per thread, not per record.
    expect(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="inspector-activity-view-conversation"]',
      ).length,
    ).toBe(1);
  });
});

describe('InspectorView, activity execution aggregates (stats totals row)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Boots on a node, expands the Activity section, settles the fetch. */
  async function bootWithStats(stats: Record<string, unknown>): Promise<HTMLElement> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats,
      recent: [],
      spawns: [],
      captureEnabled: false,
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the contextualized tools + tokens totals when stats carry summarizedRuns', async () => {
    const dom = await bootWithStats({
      count: 3,
      lastStartAt: 3000,
      distinctOwners: 1,
      toolUses: 14,
      tokens: 8300,
      summarizedRuns: 2,
    });
    const totals = dom.querySelector('[data-testid="inspector-activity-exec-totals"]');
    expect(totals).not.toBeNull();
    expect(totals!.textContent).toContain('14 tools · 8.3k tokens (2 summarized runs)');
  });

  it('uses the singular run label for one summarized run', async () => {
    const dom = await bootWithStats({
      count: 1,
      lastStartAt: 1000,
      distinctOwners: 1,
      toolUses: 1,
      tokens: 500,
      summarizedRuns: 1,
    });
    const totals = dom.querySelector('[data-testid="inspector-activity-exec-totals"]');
    expect(totals!.textContent).toContain('1 tool · 500 tokens (1 summarized run)');
  });

  it('hides the totals row when the stats carry no aggregates (never-summarized node)', async () => {
    const dom = await bootWithStats({ count: 3, lastStartAt: 3000, distinctOwners: 1 });
    // The stats grid renders (count > 0) but the totals row does not.
    expect(dom.querySelector('[data-testid="inspector-activity-stats"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-exec-totals"]')).toBeNull();
  });
});

describe('InspectorView, activity recent tool detail', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the per-run tool detail when present and skips it when absent', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 2, lastStartAt: 3000, distinctOwners: 1 },
      recent: [
        { at: 3000, owner: 'main:abc', detail: 'notion-create-pages' },
        { at: 2000, owner: 'main:abc' },
      ],
      spawns: [],
      captureEnabled: false,
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 2, lastStartAt: 3000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-recent-row"]',
    );
    expect(rows.length).toBe(2);
    // Only the frame that carried a detail paints the tool label.
    const details = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-recent-detail"]',
    );
    expect(details.length).toBe(1);
    expect(details[0]!.textContent).toContain('notion-create-pages');
  });
});

describe('InspectorView, activity recent directional invocations', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Boots on a node, expands the Activity section with the given recent ring. */
  async function bootWithRecent(
    recent: readonly Record<string, unknown>[],
  ): Promise<ComponentFixture<InspectorView>> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: recent.length, lastStartAt: 3000, distinctOwners: 1 },
      recent,
      spawns: [],
      captureEnabled: false,
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: recent.length })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    return fixture;
  }

  it('renders an MCP INCOMING row (caller): type icon, node link, tool, and navigates', async () => {
    const fixture = await bootWithRecent([
      {
        at: 3000,
        owner: 'main:abc',
        kind: 'mcp',
        detail: 'notion-create-pages',
        caller: '.claude/skills/deploy/SKILL.md',
      },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    // MCP type icon (wrench), not the read icon.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-read"]')).toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    // Counterpart (the caller) shown as its readable node label, raw path in title.
    expect(link!.textContent).toContain('deploy');
    expect(link!.getAttribute('title')).toBe('.claude/skills/deploy/SKILL.md');
    // An mcp row carries the trailing tool segment.
    const tool = dom.querySelector('[data-testid="inspector-activity-recent-tool"]');
    expect(tool).not.toBeNull();
    expect(tool!.textContent).toContain('notion-create-pages');
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).toBeNull();

    // Clicking the link navigates via the shared node-open intent.
    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('.claude/skills/deploy/SKILL.md');
  });

  it('renders an MCP OUTGOING row (target) with the mcp server name and navigates', async () => {
    const fixture = await bootWithRecent([
      { at: 3000, owner: 'main:abc', kind: 'mcp', detail: 'notion-create-pages', target: 'mcp://notion' },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).not.toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    // Counterpart (the target) shown as the mcp server name, not `mcp://notion`.
    expect(link!.textContent).toContain('notion');
    expect(link!.textContent).not.toContain('mcp://');
    expect(link!.getAttribute('title')).toBe('mcp://notion');
    expect(dom.querySelector('[data-testid="inspector-activity-recent-tool"]')).not.toBeNull();

    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('mcp://notion');
  });

  it('renders a READ row (kind read, no detail): type icon + node link, NO tool segment', async () => {
    const fixture = await bootWithRecent([
      { at: 3000, owner: 'main:abc', kind: 'read', target: 'docs/architecture.md' },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    // Read type icon (document), not the mcp icon.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-read"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('architecture');
    expect(link!.getAttribute('title')).toBe('docs/architecture.md');
    // A read has no tool, so NO trailing tool segment (and no plain chip).
    expect(dom.querySelector('[data-testid="inspector-activity-recent-tool"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).toBeNull();

    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('docs/architecture.md');
  });

  it('renders a PLAIN row (neither caller nor target) with the short owner and no node link', async () => {
    const fixture = await bootWithRecent([{ at: 3000, owner: 'main:abc', detail: 'read-tool' }]);
    const dom: HTMLElement = fixture.nativeElement;
    // Plain detail chip, no node link.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-node"]')).toBeNull();
    // The short owner still renders on the row.
    const row = dom.querySelector('[data-testid="inspector-activity-recent-row"]');
    expect(row!.textContent).toContain('main:abc');
  });
});

describe('InspectorView, activity live refresh (node.activity re-fetch)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('re-fetches the activity detail on a node.activity frame while the section is open', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
    });

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    // Expand the Activity section: the first (loud) fetch.
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // A live execution frame lands: after the debounce window the section
    // silently re-fetches the SAME node's detail (no navigation, no scan).
    vi.useFakeTimers();
    try {
      nodeActivity$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('coalesces a burst of node.activity frames into ONE re-fetch (debounced)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
    });

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // Five frames inside one debounce window collapse to a single trailing
    // re-fetch, not five GETs.
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) {
        nodeActivity$.next();
        vi.advanceTimersByTime(100);
      }
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBe(before + 1);
  });

  it('re-fetches the activity detail on an agent.spawn frame while the section is open', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
    });

    const { fixture, agentSpawn$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // A spawn thread starts: the section's spawn rows must refresh live too.
    vi.useFakeTimers();
    try {
      agentSpawn$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('ignores node.activity frames when the section was never opened (no fetch)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Section is collapsed by default: never fetched, so the guard holds.
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      nodeActivity$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();
  });
});

describe('InspectorView, header version (catalog curation)', () => {
  it('renders sidecar.annotations.version as a header suffix', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 7 },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const v = fixture.nativeElement.querySelector('[data-testid="inspector-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('v7');
  });
});
