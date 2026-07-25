import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { DeferBlockBehavior, TestBed, type ComponentFixture } from '@angular/core/testing';
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

/**
 * The `core/node-set-tags` action-button contribution whose PRESENCE
 * gates the inline tag row (surface follows the plugin, mirror of the
 * stability / version chips). Default on every fixture node so the tag
 * row specs keep exercising the row; pass `contributions: []` to model
 * the disabled plugin.
 */
function setTagsContribution() {
  return {
    pluginId: 'core',
    extensionId: 'node-set-tags',
    nodePath: 'agents/architect.md',
    contributionId: 'editTagsButton',
    slot: 'inspector.surface.tags',
    payload: { actionId: 'core/node-set-tags', label: 'Edit tags', enabled: true },
  };
}

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: { name: 'architect', description: '', metadata: { version: '1.0.0' } },
    contributions: [setTagsContribution()],
    ...overrides,
  } as INodeView;
}

function nodeWithTags(tags: string[]): INodeView {
  return makeNode({ sidecar: { present: true, status: 'fresh', annotations: { tags } } });
}

async function bootstrap(
  node: INodeView,
  dispatcher: ReturnType<typeof makeStub> = makeStub(),
): Promise<ComponentFixture<InspectorHeader>> {
  TestBed.resetTestingModule();
  // The header hosts deferred dialog chunks (`@defer`), which need the
  // async compile step + playthrough behavior under the test rig (same
  // pattern as the node-action-button spec).
  await TestBed.configureTestingModule({
    imports: [InspectorHeader],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ActionDispatchService, useValue: dispatcher },
      { provide: CollectionLoaderService, useValue: { nodes: signal<INodeView[]>([]) } },
    ],
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
  }).compileComponents();
  const fixture = TestBed.createComponent(InspectorHeader);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return fixture;
}

function nodeTags(fixture: ComponentFixture<InspectorHeader>): NodeTags {
  return fixture.debugElement.query(By.directive(NodeTags)).componentInstance as NodeTags;
}

describe('InspectorHeader tag row delegation', () => {
  it('mounts <sm-node-tags> with the node tags and path', async () => {
    const fixture = await bootstrap(nodeWithTags(['infra', 'review']));
    const child = nodeTags(fixture);
    expect(child.tags()).toEqual(['infra', 'review']);
    expect(child.nodePath()).toBe('agents/architect.md');
  });

  it('mounts the row even when the node has no tags (so the first can be added)', async () => {
    const fixture = await bootstrap(makeNode());
    const child = nodeTags(fixture);
    expect(child).toBeTruthy();
    expect(child.tags()).toEqual([]);
  });

  it('forwards the child tagClick through its own tagClick output', async () => {
    const fixture = await bootstrap(nodeWithTags(['infra', 'review']));
    const emitted: string[] = [];
    fixture.componentInstance.tagClick.subscribe((t: string) => emitted.push(t));

    nodeTags(fixture).tagClick.emit('review');

    expect(emitted).toEqual(['review']);
  });

  it('passes the active tag down to the child', async () => {
    const fixture = await bootstrap(nodeWithTags(['infra', 'review']));
    fixture.componentRef.setInput('activeTag', 'review');
    fixture.detectChanges();
    expect(nodeTags(fixture).activeTag()).toBe('review');
  });

  it('hides the row entirely without the core/node-set-tags contribution, even with tags set', async () => {
    // Surface follows the plugin (user call 2026-07-21, mirror of the
    // stability chip): action disabled -> no tag row, no chips, no
    // editor; the tags stay in the .sm.
    const fixture = await bootstrap(
      makeNode({
        sidecar: { present: true, status: 'fresh', annotations: { tags: ['infra'] } },
        contributions: [],
      }),
    );
    expect(fixture.debugElement.query(By.directive(NodeTags))).toBeNull();
  });
});

describe('InspectorHeader stability chip (the Set stability affordance)', () => {
  it('hides entirely without the contribution, even when the annotation is set', async () => {
    // The surface follows the PLUGIN (user call 2026-07-21): with
    // `core/node-set-stability` disabled the header shows no stability
    // at all; the data stays untouched in the `.sm`.
    for (const node of [
      makeNode(),
      makeNode({
        sidecar: { present: true, status: 'fresh', annotations: { stability: 'experimental' } },
      }),
    ]) {
      const fixture = await bootstrap(node);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="inspector-stability-tag"]',
        ),
      ).toBeNull();
    }
  });

  it('with the set-stability contribution the chip is clickable and opens the prompt dialog', async () => {
    const fixture = await bootstrap(
      makeNode({
        contributions: [
          {
            pluginId: 'core',
            extensionId: 'node-set-stability',
            nodePath: 'agents/architect.md',
            contributionId: 'setStabilityButton',
            slot: 'inspector.surface.stability',
            payload: {
              actionId: 'core/node-set-stability',
              label: 'Set stability',
              enabled: true,
              prompt: {
                inputType: 'enum-pick',
                paramKey: 'stability',
                label: 'Set stability',
                options: [
                  { value: 'stable', label: 'stable' },
                  { value: 'beta', label: 'beta' },
                ],
                defaultValue: 'stable',
              },
            },
          },
        ],
      }),
    );
    const chip = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-stability-tag"]',
    ) as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    chip.click();
    await fixture.whenStable();
    fixture.detectChanges();
    // The shared action-prompt dialog mounted (deferred, playthrough).
    expect(document.querySelector('sm-action-prompt-dialog')).not.toBeNull();
  });

  it('confirming the prompt dispatches core/node-set-stability with the picked value', async () => {
    const stub = makeStub();
    const fixture = await bootstrap(
      makeNode({
        contributions: [
          {
            pluginId: 'core',
            extensionId: 'node-set-stability',
            nodePath: 'agents/architect.md',
            contributionId: 'setStabilityButton',
            slot: 'inspector.surface.stability',
            payload: {
              actionId: 'core/node-set-stability',
              label: 'Set stability',
              enabled: true,
              prompt: {
                inputType: 'enum-pick',
                paramKey: 'stability',
                label: 'Set stability',
                options: [{ value: 'stable', label: 'stable' }],
                defaultValue: 'stable',
              },
            },
          },
        ],
      }),
      stub,
    );
    // Drive the confirm through the component seam (the dialog's inner
    // select widgets are its own spec's concern).
    interface IStabilityProto {
      onStabilityConfirmed(value: string): Promise<void>;
    }
    await (fixture.componentInstance as unknown as IStabilityProto).onStabilityConfirmed('stable');
    expect(stub.dispatch).toHaveBeenCalledWith('core/node-set-stability', 'agents/architect.md', {
      stability: 'stable',
    });
  });
});

describe('InspectorHeader version chip (the Bump affordance)', () => {
  const bumpContribution = (enabled = true) => ({
    pluginId: 'core',
    extensionId: 'node-bump',
    nodePath: 'agents/architect.md',
    contributionId: 'bumpButton',
    slot: 'inspector.surface.version',
    payload: {
      actionId: 'core/node-bump',
      label: 'Bump',
      enabled,
      ...(enabled ? {} : { disabledReason: 'nothing to bump' }),
    },
  });

  it('hides entirely without the contribution, even when a version exists', async () => {
    const fixture = await bootstrap(makeNode());
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="inspector-version"]',
      ),
    ).toBeNull();
  });

  it('shows the bump placeholder for a versionless file and dispatches on click', async () => {
    const stub = makeStub();
    const fixture = await bootstrap(
      makeNode({
        frontmatter: { name: 'architect', description: '' },
        contributions: [bumpContribution()],
      }),
      stub,
    );
    const chip = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-version"]',
    ) as HTMLButtonElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('v?');
    expect(chip.disabled).toBe(false);
    chip.click();
    await fixture.whenStable();
    expect(stub.dispatch).toHaveBeenCalledWith('core/node-bump', 'agents/architect.md', undefined);
  });

  it('shows the effective version and honors the disabled gate', async () => {
    const fixture = await bootstrap(
      makeNode({
        sidecar: { present: true, status: 'fresh', annotations: { version: 3 } },
        contributions: [bumpContribution(false)],
      }),
    );
    const chip = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-version"]',
    ) as HTMLButtonElement;
    expect(chip.textContent).toContain('v3');
    expect(chip.disabled).toBe(true);
  });
});

/**
 * The path chip is click-to-copy, mirror of the debug panel's hash cells:
 * clicking writes the FULL project-relative path and pins the confirmed
 * icon state; a blocked clipboard leaves the chip untouched.
 */
describe('InspectorHeader path chip (click-to-copy)', () => {
  /** Swap in a fake `navigator.clipboard`; returns a restore thunk. */
  function stubClipboard(writeText: ReturnType<typeof vi.fn>): () => void {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    return () => {
      if (original) {
        Object.defineProperty(navigator, 'clipboard', original);
      } else {
        Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard');
      }
    };
  }

  function pathButton(fixture: ComponentFixture<InspectorHeader>): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-path-copy"]',
    ) as HTMLButtonElement;
  }

  it('writes the full path to the clipboard and confirms with the check icon', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard(writeText);
    try {
      const fixture = await bootstrap(makeNode());
      const button = pathButton(fixture);
      expect(button).not.toBeNull();
      expect(button.querySelector('[data-testid="inspector-path"]')?.textContent).toBe(
        'agents/architect.md',
      );

      button.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(writeText).toHaveBeenCalledWith('agents/architect.md');
      expect(button.querySelector('.pi-check')).not.toBeNull();
      expect(button.querySelector('.pi-copy')).toBeNull();
    } finally {
      restore();
    }
  });

  it('stays in its idle state when the clipboard write is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const restore = stubClipboard(writeText);
    try {
      const fixture = await bootstrap(makeNode());
      const button = pathButton(fixture);

      button.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(writeText).toHaveBeenCalledOnce();
      expect(button.querySelector('.pi-check')).toBeNull();
      expect(button.querySelector('.pi-copy')).not.toBeNull();
    } finally {
      restore();
    }
  });
});
