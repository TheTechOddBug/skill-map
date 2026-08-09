import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { DeferBlockBehavior, TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { InspectorHeader } from '../inspector-header';
import { NodeTags } from '../../node-tags/node-tags';
import { ActionDispatchService } from '../../../../services/action-dispatch';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import {
  ProcessingAgentReadinessService,
  type TSubmitGateReason,
} from '../../../services/processing-agent-readiness';
import { INSPECTOR_VIEW_TEXTS } from '../../../../i18n/inspector-view.texts';
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
  /**
   * The shared processing-agent gate. `false` (skill installed) is the
   * default so the pre-existing specs keep their enabled affordances;
   * `true` closes it, `null` is the unknown that must fail OPEN.
   */
  skillMissing: boolean | null = false,
  /**
   * The agent-silent half of the same gate: `true` = a manual check ran
   * and nobody answered (gate CLOSED even with the skill installed);
   * `false` / `null` = no red verdict, the gate stays open.
   */
  agentSilent: boolean | null = false,
): Promise<ComponentFixture<InspectorHeader>> {
  const gateReason: TSubmitGateReason | null =
    skillMissing === true ? 'skill-missing' : agentSilent === true ? 'agent-silent' : null;
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
      // Both the header and its `<sm-node-tags>` child read the shared
      // submit gate; the real service probes the BFF, so it is stubbed
      // down to the one signal they consume.
      {
        provide: ProcessingAgentReadinessService,
        useValue: {
          skillMissing: signal<boolean | null>(skillMissing),
          submitGateReason: signal<TSubmitGateReason | null>(gateReason),
          submitGateClosed: signal<boolean>(gateReason !== null),
        } as unknown as ProcessingAgentReadinessService,
      },
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

/**
 * Processing-agent gate: with no agent set up to drain the queue for
 * the active lens, every affordance that would SUBMIT a job sits
 * disabled (visible, never hidden) with a terse tooltip stating the
 * requirement. `null` (unknown) fails OPEN.
 */
describe('InspectorHeader summarize button, processing-agent gate', () => {
  function summarizeBtn(fixture: ComponentFixture<InspectorHeader>): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-summarize"]',
    ) as HTMLButtonElement;
  }

  it('gate CLOSED: the button stays visible but disabled, with the short tooltip', async () => {
    const fixture = await bootstrap(makeNode(), makeStub(), true);
    fixture.componentRef.setInput('summaryState', 'idle');
    fixture.detectChanges();

    const btn = summarizeBtn(fixture);
    expect(btn).not.toBeNull(); // disabled, NOT hidden
    expect(btn.querySelector('.pi-sparkles')).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe(
      INSPECTOR_VIEW_TEXTS.header.summary.tooltipNoAgent,
    );
  });

  it('gate OPEN (skill installed): enabled, with its normal idle tooltip', async () => {
    const fixture = await bootstrap(makeNode(), makeStub(), false);
    fixture.componentRef.setInput('summaryState', 'idle');
    fixture.detectChanges();

    const btn = summarizeBtn(fixture);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe(INSPECTOR_VIEW_TEXTS.header.summary.tooltipIdle);
  });

  /**
   * The other half of the gate: the skill IS installed, but a manual
   * full-circuit check ran and no agent answered, so a submit would sit
   * in the queue with nobody to drain it. The tooltip names that
   * reason, not the install one.
   */
  it('gate CLOSED by a silent agent (red check): disabled, with its own tooltip', async () => {
    const fixture = await bootstrap(makeNode(), makeStub(), false, true);
    fixture.componentRef.setInput('summaryState', 'idle');
    fixture.detectChanges();

    const btn = summarizeBtn(fixture);
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe(
      INSPECTOR_VIEW_TEXTS.header.summary.tooltipAgentSilent,
    );
  });

  it('no check ever ran (null) FAILS OPEN', async () => {
    const fixture = await bootstrap(makeNode(), makeStub(), false, null);
    fixture.componentRef.setInput('summaryState', 'idle');
    fixture.detectChanges();

    const btn = summarizeBtn(fixture);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe(INSPECTOR_VIEW_TEXTS.header.summary.tooltipIdle);
  });

  it('unknown gate (null) FAILS OPEN: enabled with the normal tooltip', async () => {
    const fixture = await bootstrap(makeNode(), makeStub(), null);
    fixture.componentRef.setInput('summaryState', 'idle');
    fixture.detectChanges();

    const btn = summarizeBtn(fixture);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe(INSPECTOR_VIEW_TEXTS.header.summary.tooltipIdle);
  });

  it('a closed gate never locks a STORED analysis: ready still toggles the block', async () => {
    // `ready` submits nothing (it opens / closes the block), so gating
    // it would hide an already-computed judgment behind an agent the
    // user does not need to read it. The block's own "Analyze again"
    // button carries the gate instead.
    const fixture = await bootstrap(makeNode(), makeStub(), true);
    fixture.componentRef.setInput('summaryState', 'ready');
    fixture.componentRef.setInput('summaryExpanded', true);
    fixture.componentRef.setInput('summaryRows', [
      {
        summarizerActionId: 'core/summarizer',
        generatedAt: 1,
        stale: false,
        report: { whatItCovers: 'A subject line.' },
      },
    ]);
    fixture.detectChanges();

    expect(summarizeBtn(fixture).disabled).toBe(false);
    expect(summarizeBtn(fixture).getAttribute('aria-label')).toBe(
      INSPECTOR_VIEW_TEXTS.header.summary.tooltipReady,
    );
    const refresh = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-summary-refresh"]',
    ) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
  });

  it('"Analyze again" goes busy while a re-run is in flight (disabled + spinner + state tooltip)', async () => {
    // The block stays visible during a re-run (the stored rows persist),
    // so the refresh button mirrors the header affordance: locked and
    // visibly busy instead of a static icon that looks clickable.
    const fixture = await bootstrap(makeNode(), makeStub(), false);
    fixture.componentRef.setInput('summaryState', 'running');
    fixture.componentRef.setInput('summaryExpanded', true);
    fixture.componentRef.setInput('summaryRows', [
      {
        summarizerActionId: 'core/summarizer',
        generatedAt: 1,
        stale: false,
        report: { whatItCovers: 'A subject line.' },
      },
    ]);
    fixture.detectChanges();

    const refresh = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-summary-refresh"]',
    ) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute('aria-label')).toBe(
      INSPECTOR_VIEW_TEXTS.header.summary.tooltipRunning,
    );
    expect(refresh.querySelector('.pi-spinner')).not.toBeNull();

    fixture.componentRef.setInput('summaryState', 'queued');
    fixture.detectChanges();
    expect(refresh.disabled).toBe(true);
    expect(refresh.querySelector('.pi-clock')).not.toBeNull();
  });
});

describe('InspectorHeader physical-stat chips (T / B pills, 2026-08-08)', () => {
  it('renders tokens + bytes beside the path with compact values', async () => {
    const fixture = await bootstrap(
      makeNode({ tokensTotal: 12_420, bytesTotal: 3_100, modifiedAtMs: 1_700_000_000_000 }),
    );
    const dom = fixture.nativeElement as HTMLElement;
    const tokens = dom.querySelector('[data-testid="inspector-header-tokens"]');
    const bytes = dom.querySelector('[data-testid="inspector-header-bytes"]');
    expect(tokens).not.toBeNull();
    expect(bytes).not.toBeNull();
    expect(tokens!.textContent).toContain('T');
    expect(tokens!.textContent).toContain('12');
    expect(bytes!.textContent).toContain('B');
    expect(bytes!.textContent).toContain('3');
  });

  it('shows tokens alone when the node has no backing file (bytes would read a meaningless 0)', async () => {
    // A virtual node carries no `modifiedAtMs`: its byte size is a hard
    // zero, but a token count can still be meaningful.
    const fixture = await bootstrap(makeNode({ tokensTotal: 900, bytesTotal: 0 }));
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('[data-testid="inspector-header-tokens"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-header-bytes"]')).toBeNull();
  });

  it('hides the pills when the stats are absent (virtual / derived nodes)', async () => {
    // No tokensTotal and no modifiedAtMs: an mcp:// style virtual node.
    const fixture = await bootstrap(makeNode({ bytesTotal: 0 }));
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('[data-testid="inspector-header-tokens"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-header-bytes"]')).toBeNull();
  });
});

describe('InspectorHeader ignore affordance', () => {
  it('is hidden by default (ignoreVisible unset, e.g. demo mode)', async () => {
    const fixture = await bootstrap(makeNode());
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('[data-testid="inspector-ignore"]')).toBeNull();
  });

  it('renders when visible and emits the node path on click', async () => {
    const fixture = await bootstrap(makeNode());
    fixture.componentRef.setInput('ignoreVisible', true);
    fixture.detectChanges();

    const paths: string[] = [];
    fixture.componentInstance.ignoreClick.subscribe((p) => paths.push(p));

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="inspector-ignore"]',
    );
    expect(button).not.toBeNull();
    expect(button!.querySelector('.pi-ban')).not.toBeNull();
    button!.click();
    expect(paths).toEqual(['agents/architect.md']);
  });
});
