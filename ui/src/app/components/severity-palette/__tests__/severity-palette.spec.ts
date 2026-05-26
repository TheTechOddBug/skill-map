import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { SeverityPalette } from '../severity-palette';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilterStoreService } from '../../../../services/filter-store';
import { IssuePathsService, type IIssuePathsBySeverity } from '../../../../services/issue-paths';
import type { INodeView } from '../../../../models/node';

/**
 * Stubs the three services SeverityPalette depends on. Mirrors the
 * kind-palette spec pattern: each stub exposes only the surface the
 * component actually reads. The TestBed override path keeps the
 * harness independent from the full data layer.
 */
function makeFixture(opts: {
  /** Per-tier node paths with at least one issue of that severity. */
  errors?: readonly string[];
  warns?: readonly string[];
  /** Loaded nodes (paths); subset of `errors` / `warns` are still visible. */
  nodes?: readonly string[];
  /** Optional pre-applied filter, restricts what `apply()` returns. */
  visiblePaths?: readonly string[];
  errorActive?: boolean;
  warnActive?: boolean;
}) {
  const loaderNodes: INodeView[] = (opts.nodes ?? []).map(
    (p) => ({ path: p, kind: 'agent', provider: 'core', frontmatter: { name: p } }) as unknown as INodeView,
  );
  const loader = {
    nodes: signal<INodeView[]>(loaderNodes).asReadonly(),
    scan: signal(null).asReadonly(),
  };
  const issuePaths = {
    bySeverity: signal<IIssuePathsBySeverity>({
      errors: new Set(opts.errors ?? []),
      warns: new Set(opts.warns ?? []),
    }).asReadonly(),
  };
  const errorActive = signal<boolean>(opts.errorActive === true);
  const warnActive = signal<boolean>(opts.warnActive === true);
  // The component calls `filters.apply(nodes, ctx)`; the stub honours
  // the optional `visiblePaths` whitelist when provided so a test can
  // emulate the "an unrelated filter narrowed the visible set" branch
  // without rebuilding the full filter pipeline here.
  const filters = {
    severityErrorActive: errorActive.asReadonly(),
    severityWarnActive: warnActive.asReadonly(),
    isSeverityActive: (tier: 'error' | 'warn') =>
      tier === 'error' ? errorActive() : warnActive(),
    toggleSeverity: (tier: 'error' | 'warn') => {
      if (tier === 'error') errorActive.set(!errorActive());
      else warnActive.set(!warnActive());
    },
    apply: (nodes: INodeView[]) => {
      if (opts.visiblePaths === undefined) return nodes;
      const allow = new Set(opts.visiblePaths);
      return nodes.filter((n) => allow.has(n.path));
    },
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SeverityPalette],
    providers: [
      { provide: CollectionLoaderService, useValue: loader },
      { provide: FilterStoreService, useValue: filters },
      { provide: IssuePathsService, useValue: issuePaths },
    ],
  });
  const fixture = TestBed.createComponent(SeverityPalette);
  fixture.detectChanges();
  return { fixture, errorActive, warnActive };
}

describe('SeverityPalette', () => {
  it('renders one button per severity tier that has at least one affected node', () => {
    const { fixture } = makeFixture({
      errors: ['a.md'],
      warns: ['b.md'],
      nodes: ['a.md', 'b.md'],
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="severity-palette-error"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="severity-palette-warn"]')).not.toBeNull();
  });

  it('shows the count of currently visible nodes per tier (not the raw count)', () => {
    // 3 nodes carry errors in the data but only `a.md` is visible
    // (the others got dropped by an unrelated filter, modelled here
    // via `visiblePaths`). The badge must reflect the live view.
    const { fixture } = makeFixture({
      errors: ['a.md', 'b.md', 'c.md'],
      warns: ['c.md'],
      nodes: ['a.md', 'b.md', 'c.md'],
      visiblePaths: ['a.md'],
    });
    const root = fixture.nativeElement as HTMLElement;
    const errBtn = root.querySelector('[data-testid="severity-palette-error"]');
    const warnBtn = root.querySelector('[data-testid="severity-palette-warn"]');
    expect(errBtn?.textContent?.trim()).toBe('1');
    // `c.md` is the only warn-carrier and it is not in the visible
    // set, so the warn badge shows 0 even though the button stays
    // visible (raw count is 1, the operator can still toggle).
    expect(warnBtn?.textContent?.trim()).toBe('0');
  });

  it('hides the warn button when no node carries a warn-severity issue', () => {
    const { fixture } = makeFixture({
      errors: ['a.md'],
      nodes: ['a.md'],
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="severity-palette-error"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="severity-palette-warn"]')).toBeNull();
  });

  it('renders nothing when no node has any error or warn issue', () => {
    const { fixture } = makeFixture({ nodes: ['a.md'] });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="severity-palette"]')).toBeNull();
  });

  it('keeps the button visible when its visible count is zero but the filter is active', () => {
    // No visible node carries an error (filter outside this palette
    // narrowed the set), but the data still has error nodes AND the
    // filter is currently on. The button must stay so the operator
    // can toggle the tier off.
    const { fixture } = makeFixture({
      errors: ['a.md'],
      nodes: ['a.md'],
      visiblePaths: [],
      errorActive: true,
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="severity-palette-error"]')).not.toBeNull();
  });

  it('clears an active filter whose tier just dropped to zero affected nodes', () => {
    // The data has no error nodes but the toggle was left on from a
    // previous state. The auto-clear effect flips it off so the
    // operator never sees an empty graph with no UI to recover.
    const { errorActive } = makeFixture({
      warns: ['a.md'],
      nodes: ['a.md'],
      errorActive: true,
    });
    expect(errorActive()).toBe(false);
  });
});
