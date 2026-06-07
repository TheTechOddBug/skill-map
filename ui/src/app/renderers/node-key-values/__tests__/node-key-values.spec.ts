import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { NodeKeyValues } from '../node-key-values';
import type { IRendererInputs } from '../../../slots/slot-renderer-map';

/**
 * NodeKeyValues renderer (`inspector.body.panel.key-values` slot). The
 * payload was renamed from the generic `entries` to the slot-specific
 * `pairs` field; these tests pin that the renderer reads `pairs` and
 * drops to the empty-text branch on a payload that still carries the old
 * `entries` name (proving the rename is enforced, not silently aliased).
 */

function makeInputs(overrides: Partial<IRendererInputs> = {}): IRendererInputs {
  return {
    pluginId: 'core',
    extensionId: 'frontmatter-stats',
    contributionId: 'fmKeyValues',
    nodePath: 'agents/architect.md',
    payload: {},
    ...overrides,
  };
}

function bootstrap(inputs: IRendererInputs): ComponentFixture<NodeKeyValues> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(NodeKeyValues);
  fixture.componentRef.setInput('inputs', inputs);
  fixture.detectChanges();
  return fixture;
}

function root(fixture: ComponentFixture<NodeKeyValues>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="renderer-node-key-values"]',
  ) as HTMLElement;
}

function terms(fixture: ComponentFixture<NodeKeyValues>): NodeListOf<HTMLElement> {
  return root(fixture).querySelectorAll('.vc-kv__list dt');
}

function defs(fixture: ComponentFixture<NodeKeyValues>): NodeListOf<HTMLElement> {
  return root(fixture).querySelectorAll('.vc-kv__list dd');
}

describe('NodeKeyValues', () => {
  it('renders the data-testid root', () => {
    const fixture = bootstrap(makeInputs());
    expect(root(fixture)).not.toBeNull();
  });

  it('renders one key/value pair per element of the `pairs` field', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: {
          pairs: [
            { key: 'model', value: 'opus' },
            { key: 'lines', value: 42 },
          ],
        },
      }),
    );
    const dt = terms(fixture);
    const dd = defs(fixture);
    expect(dt.length).toBe(2);
    expect(dd.length).toBe(2);
    expect(dt[0].textContent).toBe('model');
    expect(dd[0].textContent).toBe('opus');
    expect(dt[1].textContent).toBe('lines');
    expect(dd[1].textContent).toBe('42');
  });

  it('reads `pairs`, not the legacy `entries` field (empty on the old name)', () => {
    const fixture = bootstrap(
      makeInputs({
        payload: {
          entries: [
            { key: 'model', value: 'opus' },
            { key: 'lines', value: 42 },
          ],
        },
      }),
    );
    expect(terms(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-kv__empty')).not.toBeNull();
  });

  it('shows the empty-text placeholder for an empty `pairs` array', () => {
    const fixture = bootstrap(makeInputs({ emptyText: 'No metadata', payload: { pairs: [] } }));
    expect(terms(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-kv__empty')!.textContent).toBe('No metadata');
  });

  it('shows the empty-text placeholder when the `pairs` field is missing', () => {
    const fixture = bootstrap(makeInputs({ payload: {} }));
    expect(terms(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-kv__empty')).not.toBeNull();
  });

  it('falls back to the default empty text when none is supplied', () => {
    const fixture = bootstrap(makeInputs({ payload: { pairs: [] } }));
    expect(root(fixture).querySelector('.vc-kv__empty')!.textContent).toBe(
      'No contributions for this node.',
    );
  });

  it('tolerates a non-object payload without throwing', () => {
    const fixture = bootstrap(makeInputs({ payload: 'oops' }));
    expect(terms(fixture).length).toBe(0);
    expect(root(fixture).querySelector('.vc-kv__empty')).not.toBeNull();
  });
});
