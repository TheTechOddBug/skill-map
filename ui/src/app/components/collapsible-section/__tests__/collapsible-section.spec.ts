import { describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CollapsibleSection } from '../collapsible-section';

/**
 * `CollapsibleSection` accessibility contract (WCAG 1.3.1 / 2.4.6):
 * the section title is exposed as a level-3 heading wrapping the
 * interactive toggle button, so AT sees a real heading in the ladder
 * while the button stays the single control.
 */
@Component({
  imports: [CollapsibleSection],
  template: `<sm-collapsible-section [title]="'Findings'" [expanded]="false" />`,
})
class HostComponent {}

describe('CollapsibleSection', () => {
  function render(): HTMLElement {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('exposes the title as a level-3 heading', () => {
    const el = render();
    const heading = el.querySelector('[role="heading"]');
    expect(heading).not.toBeNull();
    expect(heading?.getAttribute('aria-level')).toBe('3');
    expect(heading?.textContent).toContain('Findings');
  });

  it('keeps a single interactive toggle button inside the heading', () => {
    const el = render();
    const heading = el.querySelector('[role="heading"]');
    const button = heading?.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });
});
