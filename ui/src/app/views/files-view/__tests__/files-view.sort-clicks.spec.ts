import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

/**
 * Repro harness for the reported bug: sorting by Activity makes the
 * active rows disappear, and a second sort click empties the table.
 * Drives the REAL header buttons like a user would.
 */
import { FilesView } from '../files-view';

// Reuse the bootstrap machinery from the interactions spec by
// duplicating the minimal parts (specs cannot import each other).
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { MAP_ISOLATE_INTENT } from '../../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import type { INodeView } from '../../../../models/node';
import type { IFolderNodeLite, INodeActivityStatsApi } from '../../../../models/api';

function makeNode(path: string, name: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name, description: '', metadata: { version: '1.0.0' } },
  };
}

function boot(activity: Record<string, number>) {
  const nodes = [
    makeNode('src/hot.md', 'hot'),
    makeNode('src/warm.md', 'warm'),
    makeNode('docs/cold.md', 'cold'),
  ];
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
    liteNodeViews: signal<INodeView[]>(
      nodes.map((n) => ({ path: n.path, kind: n.kind, frontmatter: { name: '', description: '' } }) as INodeView),
    ),
    corpusCount: signal(nodes.length),
    loading: signal(false),
    error: signal<string | null>(null),
  };
  const statsMap = new Map<string, INodeActivityStatsApi>(
    Object.entries(activity).map(([path, count]) => [
      path,
      { count, lastStartAt: 0, distinctOwners: 1 },
    ]),
  );
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CollectionLoaderService, useValue: loader },
      { provide: MAP_ISOLATE_INTENT, useValue: { isolate: () => undefined } },
      { provide: NODE_OPEN_INTENT, useValue: { open: () => undefined } },
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
          stats: signal<ReadonlyMap<string, INodeActivityStatsApi>>(statsMap),
          pairCounts: signal<ReadonlyMap<string, number>>(new Map()),
        } as unknown as NodeActivityStatsService,
      },
    ],
  });
  const fixture = TestBed.createComponent(FilesView);
  fixture.detectChanges();
  return fixture;
}

function headerButton(fixture: ReturnType<typeof boot>, col: string): HTMLButtonElement {
  const th = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    `[data-testid="files-col-${col}"]`,
  );
  if (!th) throw new Error(`missing header ${col}`);
  const btn = th.querySelector<HTMLButtonElement>('button.files__sort-btn');
  if (!btn) throw new Error(`missing sort button in ${col}`);
  return btn;
}

function leafRows(fixture: ReturnType<typeof boot>): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('tr[data-testid^="files-leaf-"]'),
  ).map((el) => el.getAttribute('data-testid') ?? '');
}

describe('FilesView: sort-by-activity click sequence (bug repro)', () => {
  it('keeps all leaves visible after sorting by Activity, then by Tokens, then back to tree', () => {
    const fixture = boot({ 'src/hot.md': 9, 'src/warm.md': 2 });

    // Tree mode boots collapsed: only the compacted single-file chain
    // (docs/cold.md) renders as a leaf; src's leaves stay hidden.
    expect(leafRows(fixture)).toEqual(['files-leaf-docs/cold.md']);

    // 1st click: flatten + sort by activity desc.
    headerButton(fixture, 'activity').click();
    fixture.detectChanges();
    expect(leafRows(fixture)).toEqual([
      'files-leaf-src/hot.md',
      'files-leaf-src/warm.md',
      'files-leaf-docs/cold.md',
    ]);

    // 2nd click on a DIFFERENT column: still all three leaves.
    headerButton(fixture, 'tokens').click();
    fixture.detectChanges();
    expect(leafRows(fixture)).toHaveLength(3);

    // 3rd: toggle activity asc (same column twice).
    headerButton(fixture, 'activity').click();
    fixture.detectChanges();
    headerButton(fixture, 'activity').click();
    fixture.detectChanges();
    expect(leafRows(fixture)).toEqual([
      'files-leaf-src/warm.md',
      'files-leaf-src/hot.md',
      'files-leaf-docs/cold.md',
    ]);

    // Back to tree: folders render again.
    headerButton(fixture, 'tree').click();
    fixture.detectChanges();
    const folders = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid^="files-folder-"]',
    );
    expect(folders.length).toBeGreaterThan(0);
  });
});
