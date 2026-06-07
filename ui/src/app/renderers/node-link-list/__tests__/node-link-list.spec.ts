import { describe, expect, it, vi, beforeEach } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { NodeLinkList } from '../node-link-list';
import { NODE_OPEN_INTENT, type INodeOpenIntent } from '../../../slots/node-open-intent';
import type { IRendererInputs } from '../../../slots/slot-renderer-map';

/**
 * NodeLinkList renderer (`inspector.body.panel.link-list` slot). The
 * payload was renamed from the generic `entries` to the slot-specific
 * `links` field; these tests pin that the renderer reads `links` and
 * drops to the empty-text branch on a payload that still carries the old
 * `entries` name. The renderer dispatches clicks through the injected
 * `NODE_OPEN_INTENT` token (it cannot emit an `output<>()` because
 * `NgComponentOutlet` does not propagate outputs), so the open intent is
 * stubbed and asserted directly.
 */

type TOpenSpy = ReturnType<typeof vi.fn<(path: string) => void>>;

interface IStubIntent extends INodeOpenIntent {
  open: TOpenSpy;
}

let intent: IStubIntent;

function makeInputs(overrides: Partial<IRendererInputs> = {}): IRendererInputs {
  return {
    pluginId: 'core',
    extensionId: 'reference-broken',
    contributionId: 'brokenLinks',
    nodePath: 'agents/architect.md',
    payload: {},
    ...overrides,
  };
}

function bootstrap(inputs: IRendererInputs): ComponentFixture<NodeLinkList> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: NODE_OPEN_INTENT, useValue: intent },
    ],
  });
  const fixture = TestBed.createComponent(NodeLinkList);
  fixture.componentRef.setInput('inputs', inputs);
  fixture.detectChanges();
  return fixture;
}

function root(fixture: ComponentFixture<NodeLinkList>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="renderer-node-link-list"]',
  ) as HTMLElement;
}

function buttons(fixture: ComponentFixture<NodeLinkList>): NodeListOf<HTMLButtonElement> {
  return root(fixture).querySelectorAll('.vc-links__btn');
}

beforeEach(() => {
  intent = { open: vi.fn() };
});

describe('NodeLinkList', () => {
  it('renders the data-testid root', () => {
    const fixture = bootstrap(makeInputs());
    expect(root(fixture)).not.toBeNull();
  });

  it('renders one item per element of the `links` field', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: {
          links: [
            { path: 'agents/builder.md', label: 'Builder' },
            { path: 'docs/intro.md' },
          ],
        },
      }),
    );
    const items = buttons(fixture);
    expect(items.length).toBe(2);
    // Custom label wins, then the path is the fallback label.
    expect(items[0].querySelector('.vc-links__label')!.textContent).toBe('Builder');
    expect(items[1].querySelector('.vc-links__label')!.textContent).toBe('docs/intro.md');
  });

  it('reads `links`, not the legacy `entries` field (empty on the old name)', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: {
          entries: [
            { path: 'agents/builder.md' },
            { path: 'docs/intro.md' },
          ],
        },
      }),
    );
    expect(buttons(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-links__empty')).not.toBeNull();
  });

  it('shows the empty-text placeholder for an empty `links` array', () => {
    const fixture = bootstrap(makeInputs({ emptyText: 'No links', payload: { links: [] } }));
    expect(buttons(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-links__empty')!.textContent).toBe('No links');
  });

  it('shows the empty-text placeholder when the `links` field is missing', () => {
    const fixture = bootstrap(makeInputs({ payload: {} }));
    expect(buttons(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-links__empty')).not.toBeNull();
  });

  it('falls back to the default empty text when none is supplied', () => {
    const fixture = bootstrap(makeInputs({ payload: { links: [] } }));
    expect(root(fixture).querySelector('.vc-links__empty')!.textContent).toBe(
      'No contributions for this node.',
    );
  });

  it('calls the NODE_OPEN_INTENT open intent with the path on click', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: {
          links: [
            { path: 'agents/builder.md', label: 'Builder' },
            { path: 'docs/intro.md' },
          ],
        },
      }),
    );
    buttons(fixture)[0].click();
    expect(intent.open).toHaveBeenCalledTimes(1);
    expect(intent.open).toHaveBeenCalledWith('agents/builder.md');

    buttons(fixture)[1].click();
    expect(intent.open).toHaveBeenCalledTimes(2);
    expect(intent.open).toHaveBeenLastCalledWith('docs/intro.md');
  });

  it('tolerates a non-object payload without throwing', () => {
    const fixture = bootstrap(makeInputs({ payload: 'oops' }));
    expect(buttons(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-links__empty')).not.toBeNull();
  });
});
