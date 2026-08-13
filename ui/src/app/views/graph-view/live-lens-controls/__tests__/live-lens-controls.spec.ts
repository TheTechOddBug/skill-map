import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { LiveLensControls } from '../live-lens-controls';
import { ActivityPlaybackService } from '../../../../../services/activity-playback';
import { LiveLensService } from '../../../../../services/live-lens';
import { NodeActivityService } from '../../../../../services/node-activity';

/**
 * Stub for `LiveLensService`: writable signals behind the real
 * read-only shape, setters drive them directly (no localStorage
 * round-trip), so the component's computeds react inside a test the
 * same way they would in production.
 */
function makeFixture(init?: {
  available?: boolean;
  activityEnabled?: boolean;
  active?: boolean;
  windowMs?: number;
}) {
  const active = signal(init?.active ?? false);
  const windowMs = signal(init?.windowMs ?? 5 * 60_000);
  const reset = vi.fn();
  const lens = {
    available: signal(init?.available ?? true).asReadonly(),
    active: active.asReadonly(),
    windowMs: windowMs.asReadonly(),
    setActive: (value: boolean) => active.set(value),
    setWindow: (ms: number) => windowMs.set(ms),
    reset,
  } as unknown as LiveLensService;
  const nodeActivity = {
    enabled: signal(init?.activityEnabled ?? true).asReadonly(),
  } as unknown as NodeActivityService;
  const playback = {
    active: signal(false).asReadonly(),
  } as unknown as ActivityPlaybackService;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LiveLensControls],
    providers: [
      { provide: LiveLensService, useValue: lens },
      { provide: NodeActivityService, useValue: nodeActivity },
      { provide: ActivityPlaybackService, useValue: playback },
    ],
  });
  const fixture = TestBed.createComponent(LiveLensControls);
  fixture.detectChanges();
  return { fixture, active, windowMs, reset };
}

function query(fixture: { nativeElement: unknown }, testid: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
}

describe('LiveLensControls', () => {
  it('renders only the toggle while the lens is off', () => {
    const { fixture } = makeFixture();
    expect(query(fixture, 'graph-lens-toggle')).not.toBeNull();
    expect(query(fixture, 'graph-lens-window')).toBeNull();
    expect(query(fixture, 'graph-lens-reset')).toBeNull();
  });

  it('renders nothing in demo mode (unavailable)', () => {
    const { fixture } = makeFixture({ available: false });
    expect(query(fixture, 'graph-lens-toggle')).toBeNull();
  });

  it('renders nothing while Real Time is off', () => {
    const { fixture } = makeFixture({ activityEnabled: false });
    expect(query(fixture, 'graph-lens-toggle')).toBeNull();
  });

  it('emits the toggle intent instead of flipping the service itself', () => {
    const { fixture, active } = makeFixture();
    const emitted = vi.fn();
    fixture.componentInstance.toggleLens.subscribe(emitted);
    (query(fixture, 'graph-lens-toggle')?.querySelector('button') as HTMLButtonElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
    // Enter/exit orchestration (snapshot + camera restore) lives in the
    // graph view's controller; the component must not shortcut it.
    expect(active()).toBe(false);
  });

  it('reflects the active state via aria-pressed and shows window + reset', () => {
    const { fixture } = makeFixture({ active: true });
    const toggleBtn = query(fixture, 'graph-lens-toggle');
    expect(toggleBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(query(fixture, 'graph-lens-window')).not.toBeNull();
    expect(query(fixture, 'graph-lens-reset')).not.toBeNull();
  });

  it('the window button face tracks the selected window', () => {
    const { fixture, windowMs } = makeFixture({ active: true });
    expect(query(fixture, 'graph-lens-window')?.textContent).toContain('5m');
    windowMs.set(Number.POSITIVE_INFINITY);
    fixture.detectChanges();
    expect(query(fixture, 'graph-lens-window')?.textContent).toContain('ALL');
  });

  it('reset delegates to the service', () => {
    const { fixture, reset } = makeFixture({ active: true });
    (query(fixture, 'graph-lens-reset')?.querySelector('button') as HTMLButtonElement).click();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
