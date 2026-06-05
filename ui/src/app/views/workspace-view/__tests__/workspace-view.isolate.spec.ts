import { describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, Injectable, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { WorkspaceView } from '../workspace-view';
import { GraphView } from '../../graph-view/graph-view';
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
import type { IScanResultApi, ILinkApi } from '../../../../models/api';

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

function makeLoaderStub(nodes: INodeView[], links: ILinkApi[]) {
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
  return {
    nodes: signal(nodes),
    scan: signal<IScanResultApi | null>(scan),
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
    .mockResolvedValue({ activeProvider: null, detected: [], source: 'none' as const, selectable: [] }),
  getProjectPreferences: vi.fn().mockResolvedValue({ scan: { referencePaths: [] } }),
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

async function bootstrap(nodes: INodeView[], links: ILinkApi[]): Promise<{
  fixture: ComponentFixture<WorkspaceView>;
  mapVisibility: MapVisibilityService;
}> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '', component: BlankPage }]),
      { provide: CollectionLoaderService, useValue: makeLoaderStub(nodes, links) },
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
});
