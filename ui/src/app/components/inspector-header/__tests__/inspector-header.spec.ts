import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { InspectorHeader } from '../inspector-header';
import { NodeTags } from '../../node-tags/node-tags';
import { ActionDispatchService } from '../../../../services/action-dispatch';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import type { INodeView } from '../../../../models/node';

/**
 * InspectorHeader delegates the tag row to `<sm-node-tags>` (which owns
 * the clickable filter chips AND the inline editor). The header is a pure
 * read-only identity block: it only sources the node's tags + path and
 * re-emits the child's `tagClick`. Chip rendering / active highlight /
 * edit flow are covered in node-tags.spec; here we only assert the
 * delegation and the event forwarding.
 *
 * `<sm-node-tags>` injects `ActionDispatchService` and
 * `CollectionLoaderService`, so both are stubbed to keep the header's DI
 * graph free of the data-source port.
 */

function makeStub() {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockReturnValue(null),
    dismissError: vi.fn(),
  };
}

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: { name: 'architect', description: '', metadata: { version: '1.0.0' } },
    ...overrides,
  } as INodeView;
}

function nodeWithTags(tags: string[]): INodeView {
  return makeNode({ sidecar: { present: true, status: 'fresh', annotations: { tags } } });
}

function bootstrap(node: INodeView): ComponentFixture<InspectorHeader> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ActionDispatchService, useValue: makeStub() },
      { provide: CollectionLoaderService, useValue: { nodes: signal<INodeView[]>([]) } },
    ],
  });
  const fixture = TestBed.createComponent(InspectorHeader);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return fixture;
}

function nodeTags(fixture: ComponentFixture<InspectorHeader>): NodeTags {
  return fixture.debugElement.query(By.directive(NodeTags)).componentInstance as NodeTags;
}

describe('InspectorHeader tag row delegation', () => {
  it('mounts <sm-node-tags> with the node tags and path', () => {
    const fixture = bootstrap(nodeWithTags(['infra', 'review']));
    const child = nodeTags(fixture);
    expect(child.tags()).toEqual(['infra', 'review']);
    expect(child.nodePath()).toBe('agents/architect.md');
  });

  it('mounts the row even when the node has no tags (so the first can be added)', () => {
    const fixture = bootstrap(makeNode());
    const child = nodeTags(fixture);
    expect(child).toBeTruthy();
    expect(child.tags()).toEqual([]);
  });

  it('forwards the child tagClick through its own tagClick output', () => {
    const fixture = bootstrap(nodeWithTags(['infra', 'review']));
    const emitted: string[] = [];
    fixture.componentInstance.tagClick.subscribe((t: string) => emitted.push(t));

    nodeTags(fixture).tagClick.emit('review');

    expect(emitted).toEqual(['review']);
  });

  it('passes the active tag down to the child', () => {
    const fixture = bootstrap(nodeWithTags(['infra', 'review']));
    fixture.componentRef.setInput('activeTag', 'review');
    fixture.detectChanges();
    expect(nodeTags(fixture).activeTag()).toBe('review');
  });
});
