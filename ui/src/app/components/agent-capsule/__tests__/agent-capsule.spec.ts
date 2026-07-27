import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AgentCapsule } from '../agent-capsule';

/**
 * `<sm-agent-capsule>`, the presentational capsule for a runtime
 * sub-agent with no scanned node. Pure input -> DOM assertions: name
 * label, count badge threshold, aria.
 */

function bootstrap(name: string, count: number, kind?: string): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(AgentCapsule);
  fixture.componentRef.setInput('name', name);
  fixture.componentRef.setInput('count', count);
  fixture.componentRef.setInput('kind', kind);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AgentCapsule', () => {
  it('renders the runtime-reported name verbatim', () => {
    const dom = bootstrap('Explore', 1);
    const label = dom.querySelector('[data-testid="agent-capsule-label"]');
    expect(label?.textContent?.trim()).toBe('Explore');
  });

  it('hides the count badge for a single live run', () => {
    const dom = bootstrap('Explore', 1);
    expect(dom.querySelector('[data-testid="agent-capsule-count"]')).toBeNull();
  });

  it('shows the aggregated live-run count from two runs on', () => {
    const dom = bootstrap('Explore', 3);
    const badge = dom.querySelector('[data-testid="agent-capsule-count"]');
    expect(badge?.textContent?.trim()).toBe('×3');
  });

  it('carries the a11y label on the host', () => {
    const dom = bootstrap('general-purpose', 2, 'agent');
    expect(dom.getAttribute('aria-label')).toContain('general-purpose');
    expect(dom.getAttribute('aria-label')).toContain('2 runs');
  });

  it('renders the robot glyph decoratively (aria-hidden)', () => {
    const dom = bootstrap('Explore', 1);
    const glyph = dom.querySelector('.sm-agent-capsule__glyph');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });
});
