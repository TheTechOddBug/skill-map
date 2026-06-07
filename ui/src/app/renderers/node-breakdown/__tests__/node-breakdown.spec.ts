import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { NodeBreakdown } from '../node-breakdown';
import type { IRendererInputs } from '../../../slots/slot-renderer-map';

/**
 * NodeBreakdown renderer (`inspector.body.panel.breakdown` slot). The
 * payload was renamed from the generic `entries` to the slot-specific
 * `bars` field; these tests pin that the renderer reads `bars` and falls
 * back to the empty-text branch on a payload that still carries the old
 * `entries` name (proving the rename is enforced, not silently aliased).
 */

function makeInputs(overrides: Partial<IRendererInputs> = {}): IRendererInputs {
  return {
    pluginId: 'core',
    extensionId: 'reference-fanout',
    contributionId: 'fanoutBreakdown',
    nodePath: 'agents/architect.md',
    payload: {},
    ...overrides,
  };
}

function bootstrap(inputs: IRendererInputs): ComponentFixture<NodeBreakdown> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(NodeBreakdown);
  fixture.componentRef.setInput('inputs', inputs);
  fixture.detectChanges();
  return fixture;
}

function root(fixture: ComponentFixture<NodeBreakdown>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="renderer-node-breakdown"]',
  ) as HTMLElement;
}

function rows(fixture: ComponentFixture<NodeBreakdown>): NodeListOf<HTMLElement> {
  return root(fixture).querySelectorAll('.vc-breakdown__row');
}

describe('NodeBreakdown', () => {
  it('renders the data-testid root', () => {
    const fixture = bootstrap(makeInputs());
    expect(root(fixture)).not.toBeNull();
  });

  it('renders one row per element of the `bars` field', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: {
          bars: [
            { label: 'docs', value: 7 },
            { label: 'agents', value: 3 },
          ],
        },
      }),
    );
    const rendered = rows(fixture);
    expect(rendered.length).toBe(2);
    expect(rendered[0].querySelector('.vc-breakdown__label')!.textContent).toBe('docs');
    expect(rendered[0].querySelector('.vc-breakdown__value')!.textContent).toBe('7');
    expect(rendered[1].querySelector('.vc-breakdown__label')!.textContent).toBe('agents');
    expect(rendered[1].querySelector('.vc-breakdown__value')!.textContent).toBe('3');
  });

  it('reads `bars`, not the legacy `entries` field (empty on the old name)', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: {
          entries: [
            { label: 'docs', value: 7 },
            { label: 'agents', value: 3 },
          ],
        },
      }),
    );
    expect(rows(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-breakdown__empty')).not.toBeNull();
  });

  it('shows the empty-text placeholder for an empty `bars` array', () => {
    const fixture = bootstrap(makeInputs({ emptyText: 'No breakdown', payload: { bars: [] } }));
    expect(rows(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-breakdown__empty')!.textContent).toBe('No breakdown');
  });

  it('shows the empty-text placeholder when the `bars` field is missing', () => {
    const fixture = bootstrap(makeInputs({ payload: {} }));
    expect(rows(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-breakdown__empty')).not.toBeNull();
  });

  it('falls back to the default empty text when none is supplied', () => {
    const fixture = bootstrap(makeInputs({ payload: { bars: [] } }));
    expect(root(fixture).querySelector('.vc-breakdown__empty')!.textContent).toBe(
      'No contributions for this node.',
    );
  });

  it('tolerates a non-object payload without throwing', () => {
    const fixture = bootstrap(makeInputs({ payload: 'oops' }));
    expect(rows(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-breakdown__empty')).not.toBeNull();
  });
});
