import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Tooltip } from 'primeng/tooltip';

import { NodeBadge } from '../node-badge';
import type { IRendererInputs } from '../../../slots/slot-renderer-map';

/**
 * NodeBadge renderer (`inspector.header.badge` slot). A generic badge
 * folding the former counter + tag sub-slots: icon and/or label and/or
 * count, optional severity tint, tooltip. Contribution data is bound
 * only via interpolation + the library `[pTooltip]` (auto-sanitized; the
 * native `title` attribute was dropped so a single tooltip shows). No
 * `[innerHTML]` / `[style]` / `[src]` / `[href]`.
 */

function makeInputs(overrides: Partial<IRendererInputs> = {}): IRendererInputs {
  return {
    pluginId: 'core',
    extensionId: 'annotation-stale',
    contributionId: 'staleBadge',
    nodePath: 'agents/architect.md',
    payload: {},
    ...overrides,
  };
}

function bootstrap(inputs: IRendererInputs): ComponentFixture<NodeBadge> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(NodeBadge);
  fixture.componentRef.setInput('inputs', inputs);
  fixture.detectChanges();
  return fixture;
}

function root(fixture: ComponentFixture<NodeBadge>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="renderer-node-badge"]',
  ) as HTMLElement;
}

/** The PrimeNG `Tooltip` directive instance bound to the badge span. */
function tooltipDir(fixture: ComponentFixture<NodeBadge>): Tooltip {
  return fixture.debugElement.query(By.directive(Tooltip)).injector.get(Tooltip);
}

describe('NodeBadge', () => {
  it('renders the data-testid root', () => {
    const fixture = bootstrap(makeInputs());
    expect(root(fixture)).not.toBeNull();
  });

  it('renders the label when the payload carries one', () => {
    const fixture = bootstrap(makeInputs({ payload: { label: 'stale' } }));
    expect(root(fixture).querySelector('.vc-badge__label')!.textContent).toBe('stale');
  });

  it('renders the count when the payload carries a number', () => {
    const fixture = bootstrap(makeInputs({ payload: { count: 3 } }));
    expect(root(fixture).querySelector('.vc-badge__count')!.textContent).toBe('3');
  });

  it('renders a count of zero (not hidden)', () => {
    const fixture = bootstrap(makeInputs({ payload: { count: 0 } }));
    expect(root(fixture).querySelector('.vc-badge__count')!.textContent).toBe('0');
  });

  it('omits the count when the payload has no numeric count', () => {
    const fixture = bootstrap(makeInputs({ payload: { label: 'x' } }));
    expect(root(fixture).querySelector('.vc-badge__count')).toBeNull();
  });

  it('renders the icon when the manifest declares one', () => {
    const fixture = bootstrap(makeInputs({ icon: 'pi pi-clock', payload: {} }));
    expect(root(fixture).querySelector('.vc-badge__icon')).not.toBeNull();
  });

  it('applies the inline severity class when no label is present', () => {
    const fixture = bootstrap(makeInputs({ payload: { count: 2, severity: 'warn' } }));
    const el = root(fixture);
    expect(el.classList.contains('vc-badge--warn')).toBe(true);
    expect(el.classList.contains('vc-badge--tinted')).toBe(false);
  });

  it('applies the chip-tint class when a label and severity are both present', () => {
    const fixture = bootstrap(makeInputs({ payload: { label: 'deprecated', severity: 'danger' } }));
    const el = root(fixture);
    expect(el.classList.contains('vc-badge--danger')).toBe(true);
    expect(el.classList.contains('vc-badge--tinted')).toBe(true);
  });

  it('binds the tooltip via the library pTooltip, not the native title attribute', () => {
    const fixture = bootstrap(makeInputs({ payload: { label: 'x', tooltip: 'Drifted since last bump' } }));
    const el = root(fixture);
    // Only the PrimeNG tooltip carries the text; the native `title`
    // attribute is gone so the browser does not stack a second tooltip.
    expect(tooltipDir(fixture).content).toBe('Drifted since last bump');
    expect(el.getAttribute('title')).toBeNull();
    expect(el.innerHTML).not.toContain('Drifted since last bump<');
  });

  it('positions the tooltip to the left so it does not run off the right edge', () => {
    const fixture = bootstrap(makeInputs({ payload: { label: 'x', tooltip: 'tip' } }));
    expect(tooltipDir(fixture).tooltipPosition).toBe('left');
  });

  it('falls back to the manifest tooltip when the payload omits one', () => {
    const fixture = bootstrap(makeInputs({ tooltip: 'manifest tip', payload: { label: 'x' } }));
    expect(tooltipDir(fixture).content).toBe('manifest tip');
    expect(root(fixture).getAttribute('title')).toBeNull();
  });

  it('tolerates a non-object payload without throwing', () => {
    const fixture = bootstrap(makeInputs({ payload: 'oops' }));
    const el = root(fixture);
    expect(el).not.toBeNull();
    expect(el.querySelector('.vc-badge__label')).toBeNull();
    expect(el.querySelector('.vc-badge__count')).toBeNull();
  });
});
