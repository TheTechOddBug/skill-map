import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FilesView } from '../files-view';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { MAP_ISOLATE_INTENT } from '../../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import type { INodeView } from '../../../../models/node';
import type { IScanResultApi } from '../../../../models/api';

/**
 * FilesView leaf-row interactions (DOM-level).
 *
 * Guards the rail's two distinct leaf gestures so they stay separate:
 *   - clicking the row activates "open in map" (`NODE_OPEN_INTENT`);
 *   - clicking the sitemap / isolate button fires the isolate gesture
 *     (`MAP_ISOLATE_INTENT`) and stops propagation, so the row's own
 *     open-intent does NOT also fire.
 *
 * The isolate scope itself (node + direct neighbors) is covered by
 * `graph-view.spec` and `workspace-view.isolate.spec`; this file only
 * pins the gesture routing at the button vs row level.
 */

const LEAF_PATH = 'readme.md';

function makeNode(path: string, name: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name, description: '', metadata: { version: '1.0.0' } },
  };
}

function makeScan(nodes: INodeView[]): IScanResultApi {
  return {
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
    links: [],
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

function makeLoaderStub(nodes: INodeView[]) {
  return {
    nodes: signal(nodes),
    scan: signal<IScanResultApi | null>(makeScan(nodes)),
    loading: signal(false),
    error: signal<string | null>(null),
    hasAnyFavorites: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
}

function bootstrap(): {
  fixture: ReturnType<typeof TestBed.createComponent<FilesView>>;
  isolate: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
} {
  const isolate = vi.fn();
  const open = vi.fn();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CollectionLoaderService, useValue: makeLoaderStub([makeNode(LEAF_PATH, 'readme')]) },
      { provide: MAP_ISOLATE_INTENT, useValue: { isolate } },
      { provide: NODE_OPEN_INTENT, useValue: { open } },
    ],
  });
  const fixture = TestBed.createComponent(FilesView);
  fixture.detectChanges();
  return { fixture, isolate, open };
}

function query(fixture: ReturnType<typeof TestBed.createComponent<FilesView>>, testid: string): HTMLElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    `[data-testid="${testid}"]`,
  );
  if (!el) throw new Error(`missing element [data-testid="${testid}"]`);
  return el;
}

describe('FilesView leaf interactions', () => {
  it('isolate button isolates the chain and does NOT open/select the row', () => {
    const { fixture, isolate, open } = bootstrap();

    query(fixture, `files-leaf-graph-${LEAF_PATH}`).click();

    expect(isolate).toHaveBeenCalledWith(LEAF_PATH);
    // The click must NOT bubble to the row's open-intent.
    expect(open).not.toHaveBeenCalled();
  });

  it('row click opens the node in the map (the reference gesture)', () => {
    const { fixture, isolate, open } = bootstrap();

    query(fixture, `files-leaf-${LEAF_PATH}`).click();

    expect(open).toHaveBeenCalledWith(LEAF_PATH);
    expect(isolate).not.toHaveBeenCalled();
  });
});
