import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { BranchCapBanner } from '../branch-cap-banner';
import { CollectionLoaderService } from '../../../../../services/collection-loader';
import type { IBranchResponseApi } from '../../../../../models/api';

/**
 * Fake `CollectionLoaderService` exposing only the surface the banner
 * reads (`branch()`).
 */
function fakeLoader(initial: IBranchResponseApi | null): {
  branch: ReturnType<typeof signal<IBranchResponseApi | null>>;
} {
  return { branch: signal<IBranchResponseApi | null>(initial) };
}

function branch(over: Partial<IBranchResponseApi['branch']>): IBranchResponseApi {
  return {
    schemaVersion: '1',
    kind: 'branch',
    branch: {
      paths: [],
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

function makeFixture(b: IBranchResponseApi | null) {
  TestBed.resetTestingModule();
  const loader = fakeLoader(b);
  TestBed.configureTestingModule({
    imports: [BranchCapBanner],
    providers: [{ provide: CollectionLoaderService, useValue: loader }],
  });
  const fixture = TestBed.createComponent(BranchCapBanner);
  fixture.detectChanges();
  return { fixture, loader };
}

describe('BranchCapBanner', () => {
  it('hides when the branch is not truncated', () => {
    const { fixture } = makeFixture(branch({ total: 10, rendered: 10, truncated: false }));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="branch-cap-banner"]')).toBeNull();
  });

  it('renders with total + rendered counts when the branch is truncated', () => {
    const { fixture } = makeFixture(branch({ total: 900, rendered: 256, truncated: true }));
    const root = fixture.nativeElement as HTMLElement;
    const banner = root.querySelector<HTMLElement>('[data-testid="branch-cap-banner"]');
    expect(banner).not.toBeNull();
    const body = root.querySelector<HTMLElement>('[data-testid="branch-cap-banner-body"]');
    expect(body?.textContent).toContain('900');
    expect(body?.textContent).toContain('256');
    expect(body?.textContent).toContain('sub-folder');
  });

  it('hides when there is no branch yet', () => {
    const { fixture } = makeFixture(null);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="branch-cap-banner"]')).toBeNull();
  });
});
