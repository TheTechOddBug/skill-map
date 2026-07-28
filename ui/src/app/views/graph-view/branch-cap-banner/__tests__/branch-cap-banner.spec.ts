import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { BranchCapBanner } from '../branch-cap-banner';
import { CollectionLoaderService } from '../../../../../services/collection-loader';
import type { IBranchResponseApi } from '../../../../../models/api';

interface IFakeLoaderInput {
  branch?: IBranchResponseApi | null;
  corpusCount?: number;
  maxRenderNodes?: number | undefined;
}

/**
 * Fake `CollectionLoaderService` exposing only the surface the banner
 * reads: `branch()`, `corpusCount()`, and `scanMeta()` (for the cap).
 */
function fakeLoader(input: IFakeLoaderInput) {
  return {
    branch: signal<IBranchResponseApi | null>(input.branch ?? null),
    corpusCount: signal<number>(input.corpusCount ?? 0),
    scanMeta: signal<{ maxRenderNodes?: number } | null>(
      input.maxRenderNodes !== undefined ? { maxRenderNodes: input.maxRenderNodes } : null,
    ),
  };
}

function branch(over: Partial<IBranchResponseApi['branch']>): IBranchResponseApi {
  return {
    schemaVersion: '1',
    kind: 'branch',
    branch: {
      paths: [],
      excluded: [],
      rootExcluded: false,
      total: 0,
      rendered: 0,
      truncated: false,
      cap: 256,
      ...over,
    },
    nodes: [],
    links: [],
    issues: [],
  };
}

function makeFixture(input: IFakeLoaderInput) {
  TestBed.resetTestingModule();
  const loader = fakeLoader(input);
  TestBed.configureTestingModule({
    imports: [BranchCapBanner],
    providers: [{ provide: CollectionLoaderService, useValue: loader }],
  });
  const fixture = TestBed.createComponent(BranchCapBanner);
  fixture.detectChanges();
  return { fixture, loader };
}

function bannerBody(fixture: ReturnType<typeof makeFixture>['fixture']): HTMLElement | null {
  const root = fixture.nativeElement as HTMLElement;
  return root.querySelector<HTMLElement>('[data-testid="branch-cap-banner-body"]');
}

describe('BranchCapBanner', () => {
  it('hides when neither the branch nor the corpus overflows the cap', () => {
    const { fixture } = makeFixture({
      branch: branch({ total: 10, rendered: 10, truncated: false }),
      corpusCount: 10,
      maxRenderNodes: 256,
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="branch-cap-banner"]')).toBeNull();
  });

  it('renders the branch-scoped copy when the selected branch is truncated', () => {
    const { fixture } = makeFixture({
      branch: branch({ total: 900, rendered: 256, truncated: true }),
      corpusCount: 900,
      maxRenderNodes: 256,
    });
    const body = bannerBody(fixture);
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain('900');
    expect(body?.textContent).toContain('256');
    expect(body?.textContent).toContain('sub-folder');
  });

  it('stays hidden when the branch fits, even while the corpus overflows the cap', () => {
    // User decision 2026-07-28: once the operator narrowed to a fitting
    // scope the corpus-wide message read as noise, so no corpus fallback.
    const { fixture } = makeFixture({
      branch: branch({ total: 40, rendered: 40, truncated: false }),
      corpusCount: 300,
      maxRenderNodes: 256,
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="branch-cap-banner"]')).toBeNull();
  });

  it('hides when there is no branch and the corpus is empty', () => {
    const { fixture } = makeFixture({ branch: null, corpusCount: 0 });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="branch-cap-banner"]')).toBeNull();
  });
});
