import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { InspectorHeader } from '../inspector-header';
import type { INodeView } from '../../../../models/node';

/**
 * InspectorHeader tag row. Sidecar-curated `annotations.tags` render as
 * clickable chips in the header (they replaced the former vendor-tools
 * row). Clicking a chip emits `tagClick`; the host forwards it to the
 * graph's tag-selection, which selects every node carrying that tag.
 * The `activeTag` input lights the matching chip.
 */

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: { name: 'architect', description: '', metadata: { version: '1.0.0' } },
    ...overrides,
  };
}

function nodeWithTags(tags: string[]): INodeView {
  return makeNode({ sidecar: { present: true, status: 'fresh', annotations: { tags } } });
}

function bootstrap(node: INodeView): ComponentFixture<InspectorHeader> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(InspectorHeader);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return fixture;
}

function tagButtons(fixture: ComponentFixture<InspectorHeader>): HTMLButtonElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[data-testid="inspector-header-tag"]',
    ),
  );
}

describe('InspectorHeader tag row', () => {
  it('renders the sidecar tags as clickable chips, in order', () => {
    const fixture = bootstrap(nodeWithTags(['infra', 'review']));
    expect(tagButtons(fixture).map((b) => b.textContent?.trim())).toEqual(['infra', 'review']);
  });

  it('emits tagClick with the clicked tag', () => {
    const fixture = bootstrap(nodeWithTags(['infra', 'review']));
    const emitted: string[] = [];
    fixture.componentInstance.tagClick.subscribe((t: string) => emitted.push(t));

    tagButtons(fixture)[1]!.click();

    expect(emitted).toEqual(['review']);
  });

  it('marks only the active tag (class + aria-pressed)', () => {
    const fixture = bootstrap(nodeWithTags(['infra', 'review']));
    fixture.componentRef.setInput('activeTag', 'review');
    fixture.detectChanges();

    const [infra, review] = tagButtons(fixture);
    expect(review!.classList.contains('inspector__tag--active')).toBe(true);
    expect(review!.getAttribute('aria-pressed')).toBe('true');
    expect(infra!.classList.contains('inspector__tag--active')).toBe(false);
    expect(infra!.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders no tag row when the node has no tags', () => {
    const fixture = bootstrap(makeNode());
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="inspector-header-tags"]'),
    ).toBeNull();
    expect(tagButtons(fixture).length).toBe(0);
  });
});
