import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { NodeCard } from './node-card';
import type { INodeView, ISidecarOverlay, TSidecarStatus } from '../../../models/node';

/**
 * Step 9.6.5 — `<sm-node-card>` sidecar stale badge tests. Asserts
 * the badge renders for the three stale variants and stays hidden
 * for `fresh` / absent overlays.
 */

function makeNode(overlay?: ISidecarOverlay): INodeView {
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

function bootstrap(node: INodeView): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(NodeCard);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('NodeCard — sidecar stale badge (Step 9.6.5)', () => {
  it('does NOT render the badge when no sidecar overlay is present', () => {
    const dom = bootstrap(makeNode());
    expect(dom.querySelector('[data-testid="node-card-stale-badge"]')).toBeNull();
  });

  it('does NOT render the badge when the overlay is fresh', () => {
    const dom = bootstrap(makeNode({ present: true, status: 'fresh' }));
    expect(dom.querySelector('[data-testid="node-card-stale-badge"]')).toBeNull();
  });

  it('does NOT render the badge when present but status is null (parse failed)', () => {
    const dom = bootstrap(makeNode({ present: true, status: null }));
    expect(dom.querySelector('[data-testid="node-card-stale-badge"]')).toBeNull();
  });

  for (const status of ['stale-body', 'stale-frontmatter', 'stale-both'] as const) {
    it(`renders the badge when status is '${status}'`, () => {
      const dom = bootstrap(makeNode({ present: true, status: status as TSidecarStatus }));
      const badge = dom.querySelector('[data-testid="node-card-stale-badge"]');
      expect(badge).not.toBeNull();
      // Ensure the clock icon is the surface choice (orange-tinted CSS class).
      expect(badge!.querySelector('.pi-clock')).not.toBeNull();
    });
  }
});
