import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SessionNode } from '../session-node';

/**
 * `<sm-session-node>`, the presentational session anchor. Pure input
 * -> DOM assertions: label, tooltip source, aria.
 */

function bootstrap(ordinal: number, owner: string): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(SessionNode);
  fixture.componentRef.setInput('ordinal', ordinal);
  fixture.componentRef.setInput('owner', owner);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('SessionNode', () => {
  it('renders the ordinal label', () => {
    const dom = bootstrap(2, 'main:abc');
    const label = dom.querySelector('[data-testid="session-node-label"]');
    expect(label?.textContent?.trim()).toBe('Session 2');
  });

  it('carries the a11y label on the host', () => {
    const dom = bootstrap(1, 'main:abc');
    expect(dom.getAttribute('aria-label')).toContain('Session 1');
  });

  it('renders the terminal glyph decoratively (aria-hidden)', () => {
    const dom = bootstrap(1, 'main:abc');
    const glyph = dom.querySelector('.sm-session-node__glyph');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });
});
