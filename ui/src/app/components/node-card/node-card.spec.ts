import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { NodeCard } from './node-card';
import type {
  IFrontmatterAgent,
  INodeStats,
  INodeView,
  ISidecarOverlay,
  TSidecarStatus,
} from '../../../models/node';

/**
 * `<sm-node-card>` — sidecar stale badge tests (Step 9.6.5) + catalog
 * curation 2026-05-07 surface tests (version suffix, tags chips,
 * footer link stats).
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

function bootstrap(node: INodeView, stats?: INodeStats): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(NodeCard);
  fixture.componentRef.setInput('node', node);
  if (stats) fixture.componentRef.setInput('stats', stats);
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

describe('NodeCard — catalog curation surfaces (2026-05-07)', () => {
  it('renders `vN` suffix to the title from sidecar.annotations.version', () => {
    const node: INodeView = {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: { name: 'architect', description: 'd', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { version: 7 },
      },
    };
    const dom = bootstrap(node);
    const v = dom.querySelector('[data-testid="node-card-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('v7');
  });

  it('falls back to legacy frontmatter.metadata.version when no sidecar version', () => {
    const node: INodeView = {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: {
        name: 'architect',
        description: 'd',
        metadata: { version: '1.2.3' },
      },
    };
    const dom = bootstrap(node);
    const v = dom.querySelector('[data-testid="node-card-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('v1.2.3');
  });

  it('hides the version suffix when neither source has a version', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'note',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
    };
    const dom = bootstrap(node);
    expect(dom.querySelector('[data-testid="node-card-version"]')).toBeNull();
  });

  it('renders up to 3 tag chips from sidecar.annotations.tags', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { tags: ['x', 'y', 'z'] },
      },
    };
    const dom = bootstrap(node);
    const tagsBlock = dom.querySelector('[data-testid="node-card-tags"]');
    expect(tagsBlock).not.toBeNull();
    expect(tagsBlock!.querySelectorAll('.sm-gnode__tag-chip').length).toBe(3);
    expect(dom.querySelector('[data-testid="node-card-tags-more"]')).toBeNull();
  });

  it('shows a "+N more" overflow when more than 3 tags', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { tags: ['a', 'b', 'c', 'd', 'e'] },
      },
    };
    const dom = bootstrap(node);
    expect(dom.querySelectorAll('.sm-gnode__tag-chip').length).toBe(3);
    const more = dom.querySelector('[data-testid="node-card-tags-more"]');
    expect(more).not.toBeNull();
    expect(more!.textContent).toContain('+2');
  });

  it('hides the tags row entirely when there are no tags', () => {
    const dom = bootstrap(makeNode());
    expect(dom.querySelector('[data-testid="node-card-tags"]')).toBeNull();
  });

  it('renders separate in / out link stats in the footer when nonzero', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      linksOutCount: 4,
      linksInCount: 2,
    };
    const dom = bootstrap(node);
    const inStat = dom.querySelector('[data-testid="node-card-links-in"]');
    const outStat = dom.querySelector('[data-testid="node-card-links-out"]');
    expect(inStat).not.toBeNull();
    expect(outStat).not.toBeNull();
    expect(inStat!.textContent).toContain('2');
    expect(outStat!.textContent).toContain('4');
    // Glyph contract: vertical arrows — down for in, up for out.
    expect(inStat!.querySelector('.pi-arrow-down')).not.toBeNull();
    expect(outStat!.querySelector('.pi-arrow-up')).not.toBeNull();
  });

  it('hides the in stat when only outgoing links exist', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      linksOutCount: 3,
      linksInCount: 0,
    };
    const dom = bootstrap(node);
    expect(dom.querySelector('[data-testid="node-card-links-in"]')).toBeNull();
    expect(dom.querySelector('[data-testid="node-card-links-out"]')).not.toBeNull();
  });

  it('hides both link stats when both counts are zero', () => {
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: { name: 'a', description: '', metadata: { version: '' } },
      linksOutCount: 0,
      linksInCount: 0,
    };
    const dom = bootstrap(node);
    expect(dom.querySelector('[data-testid="node-card-links-in"]')).toBeNull();
    expect(dom.querySelector('[data-testid="node-card-links-out"]')).toBeNull();
  });

  it('renders the footer even when there are no stats to show', () => {
    // Empty footer remains in the DOM so the collapsed card has a
    // stable bottom strip across nodes (padding + border-top render).
    const dom = bootstrap(makeNode());
    const footer = dom.querySelector('.sm-gnode__footer');
    expect(footer).not.toBeNull();
    expect(footer!.children.length).toBe(0);
  });

  it('reads vendor color from agent frontmatter (not metadata.color)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(NodeCard);
    const node: INodeView = {
      path: 'a.md',
      kind: 'agent',
      frontmatter: {
        name: 'a',
        description: '',
        metadata: { version: '' },
        // Anthropic vendor field at top-level, NOT under metadata.
        color: 'purple',
      } as IFrontmatterAgent & { color: string },
    };
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    // The host element receives the `sm-gnode--with-color` class and
    // the `--node-color` CSS var; both are wired off `agentVendorColor()`.
    const host = fixture.elementRef.nativeElement as HTMLElement;
    expect(host.classList.contains('sm-gnode--with-color')).toBe(true);
    expect(host.style.getPropertyValue('--node-color')).toBe('purple');
  });
});
