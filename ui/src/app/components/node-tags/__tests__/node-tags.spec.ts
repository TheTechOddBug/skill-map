import { describe, expect, it, vi, beforeEach } from 'vitest';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import {
  DeferBlockBehavior,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';

import { NodeTags } from '../node-tags';
import { ActionDispatchService } from '../../../../services/action-dispatch';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import type { INodeView } from '../../../../models/node';

/**
 * `<sm-node-tags>`, the inspector's inline tag row. Two modes:
 *   - VIEW: filter chips (click emits `tagClick`) + an always-present
 *     pencil affordance (so a tagless node can still get its first tag).
 *   - EDIT: pencil opens the inline editor; Save dispatches
 *     `core/node-set-tags` via `ActionDispatchService` (stubbed here);
 *     Cancel discards the draft.
 *
 * The dispatch service is stubbed so the tests assert only the
 * component's own behaviour (which action, with what input, and the
 * view <-> edit transitions), not the `.sm` consent handshake.
 */

interface IStubDispatcher {
  dispatch: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  dismissError: ReturnType<typeof vi.fn>;
}

interface INodeTagsInternals {
  editing(): boolean;
  draft(): readonly string[];
  error(): string | null;
  allTags(): readonly string[];
  descriptor(): { suggestions?: string[] };
  startEdit(): void;
  cancelEdit(): void;
  onDraftChange(v: unknown): void;
  save(): Promise<void>;
}

let stub: IStubDispatcher;
// Stub for the `CollectionLoaderService.nodes` signal `<sm-node-tags>` reads
// to build the project-wide tag vocabulary. Reset per test.
let loaderNodes: WritableSignal<INodeView[]>;

function makeStub(): IStubDispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockReturnValue(null),
    dismissError: vi.fn(),
  };
}

function nodeWithTags(path: string, tags: string[]): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name: path, description: '', metadata: {} },
    sidecar: { present: true, status: 'fresh', annotations: { tags } },
  } as INodeView;
}

async function bootstrap(
  tags: string[],
  nodePath = 'agents/architect.md',
  activeTag: string | null = null,
): Promise<ComponentFixture<NodeTags>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [NodeTags],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ActionDispatchService, useValue: stub },
      { provide: CollectionLoaderService, useValue: { nodes: loaderNodes } },
    ],
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
  }).compileComponents();
  const fixture = TestBed.createComponent(NodeTags);
  fixture.componentRef.setInput('tags', tags);
  fixture.componentRef.setInput('nodePath', nodePath);
  fixture.componentRef.setInput('activeTag', activeTag);
  fixture.detectChanges();
  return fixture;
}

function internals(fixture: ComponentFixture<NodeTags>): INodeTagsInternals {
  return fixture.componentInstance as unknown as INodeTagsInternals;
}

function chips(fixture: ComponentFixture<NodeTags>): HTMLButtonElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[data-testid="node-tags-tag"]',
    ),
  );
}

function el(fixture: ComponentFixture<NodeTags>, testid: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
}

beforeEach(() => {
  stub = makeStub();
  loaderNodes = signal<INodeView[]>([]);
});

describe('NodeTags view mode', () => {
  it('renders the tags as clickable chips, in order, plus the pencil', async () => {
    const fixture = await bootstrap(['infra', 'review']);
    expect(chips(fixture).map((b) => b.textContent?.trim())).toEqual(['infra', 'review']);
    expect(el(fixture, 'node-tags-edit')).not.toBeNull();
  });

  it('shows the pencil even with no tags (so the first can be added)', async () => {
    const fixture = await bootstrap([]);
    expect(chips(fixture).length).toBe(0);
    expect(el(fixture, 'node-tags-edit')).not.toBeNull();
  });

  it('emits tagClick with the clicked tag', async () => {
    const fixture = await bootstrap(['infra', 'review']);
    const emitted: string[] = [];
    fixture.componentInstance.tagClick.subscribe((t: string) => emitted.push(t));

    chips(fixture)[1]!.click();

    expect(emitted).toEqual(['review']);
  });

  it('marks only the active tag (class + aria-pressed)', async () => {
    const fixture = await bootstrap(['infra', 'review'], 'agents/architect.md', 'review');
    const [infra, review] = chips(fixture);
    expect(review!.classList.contains('node-tags__tag--active')).toBe(true);
    expect(review!.getAttribute('aria-pressed')).toBe('true');
    expect(infra!.classList.contains('node-tags__tag--active')).toBe(false);
    expect(infra!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('NodeTags edit mode', () => {
  it('enters edit mode on the pencil, seeding the draft with the current tags', async () => {
    const fixture = await bootstrap(['infra', 'review']);
    el(fixture, 'node-tags-edit')!.click();
    fixture.detectChanges();

    expect(internals(fixture).editing()).toBe(true);
    expect(internals(fixture).draft()).toEqual(['infra', 'review']);
    expect(el(fixture, 'node-tags-editor')).not.toBeNull();
    expect(chips(fixture).length).toBe(0); // chips are gone in edit mode
  });

  it('save dispatches core/node-set-tags with the draft, then leaves edit mode', async () => {
    const fixture = await bootstrap(['infra']);
    const api = internals(fixture);
    api.startEdit();
    api.onDraftChange(['infra', 'wip']);
    await api.save();

    expect(stub.dispatch).toHaveBeenCalledWith('core/node-set-tags', 'agents/architect.md', {
      tags: ['infra', 'wip'],
    });
    expect(api.editing()).toBe(false);
  });

  it('cancel leaves edit mode without dispatching', async () => {
    const fixture = await bootstrap(['infra']);
    const api = internals(fixture);
    api.startEdit();
    api.onDraftChange(['changed']);
    api.cancelEdit();

    expect(stub.dispatch).not.toHaveBeenCalled();
    expect(api.editing()).toBe(false);
  });

  it('closes the editor when the inspected node changes (instance is reused)', async () => {
    const fixture = await bootstrap(['infra']);
    const api = internals(fixture);
    api.startEdit();
    expect(api.editing()).toBe(true);

    fixture.componentRef.setInput('nodePath', 'agents/other.md');
    fixture.detectChanges();

    expect(api.editing()).toBe(false);
  });

  it('keeps edit mode and surfaces the error when the dispatch fails', async () => {
    stub.error.mockReturnValue('Could not write the sidecar.');
    const fixture = await bootstrap(['infra']);
    const api = internals(fixture);
    api.startEdit();
    api.onDraftChange(['infra', 'wip']);
    await api.save();

    expect(stub.dispatch).toHaveBeenCalledOnce();
    expect(api.editing()).toBe(true);
    expect(api.error()).toBe('Could not write the sidecar.');
  });

  it('drops non-string draft entries before dispatching', async () => {
    const fixture = await bootstrap([]);
    const api = internals(fixture);
    api.startEdit();
    api.onDraftChange(['ok', 7, null, 'fine']);
    await api.save();

    expect(stub.dispatch).toHaveBeenCalledWith('core/node-set-tags', 'agents/architect.md', {
      tags: ['ok', 'fine'],
    });
  });
});

describe('NodeTags suggestion vocabulary', () => {
  it('derives allTags from every loaded node, deduped and sorted', async () => {
    loaderNodes.set([
      nodeWithTags('a.md', ['infra', 'review']),
      nodeWithTags('b.md', ['review', 'docs']),
    ]);
    const fixture = await bootstrap(['infra']);
    expect(internals(fixture).allTags()).toEqual(['docs', 'infra', 'review']);
  });

  it('feeds the vocabulary to the editor descriptor as suggestions', async () => {
    loaderNodes.set([nodeWithTags('a.md', ['infra', 'docs'])]);
    const fixture = await bootstrap(['infra']);
    expect(internals(fixture).descriptor().suggestions).toEqual(['docs', 'infra']);
  });

  it('is empty when no node carries tags (degrades to a plain chips input)', async () => {
    loaderNodes.set([nodeWithTags('a.md', [])]);
    const fixture = await bootstrap([]);
    expect(internals(fixture).allTags()).toEqual([]);
  });
});
