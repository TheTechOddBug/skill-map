import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ProviderMarkerDriftBanner } from '../provider-marker-drift-banner';
import { ProjectInfoService } from '../../../services/project-info';
import type { IActiveProviderMarkerDriftApi } from '../../../../models/api';

/**
 * Stub the shared `ProjectInfoService`: a writable `markerDrift` signal
 * standing in for the read-only computed, plus an `acceptMarkerDrift` spy
 * that clears the drift the way the real service does after the
 * accept-markers round-trip.
 */
function makeFixture(drift: IActiveProviderMarkerDriftApi | null) {
  const markerDrift = signal<IActiveProviderMarkerDriftApi | null>(drift);
  const acceptSpy = vi.fn().mockImplementation(async () => {
    markerDrift.set(null);
  });
  const projectInfo: Partial<ProjectInfoService> = {
    markerDrift,
    acceptMarkerDrift: acceptSpy,
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ProviderMarkerDriftBanner],
    providers: [{ provide: ProjectInfoService, useValue: projectInfo }],
  });
  const fixture = TestBed.createComponent(ProviderMarkerDriftBanner);
  fixture.detectChanges();
  return { fixture, acceptSpy };
}

function innerButton(root: HTMLElement, testid: string): HTMLButtonElement {
  const host = root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  const button = host?.querySelector<HTMLButtonElement>('button');
  if (!button) throw new Error(`no <button> under [data-testid="${testid}"]`);
  return button;
}

describe('ProviderMarkerDriftBanner', () => {
  it('shows the notice when markers drifted', () => {
    const { fixture } = makeFixture({ added: ['claude'], removed: [], detected: ['claude'] });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="provider-marker-drift-banner"]')).not.toBeNull();
  });

  it('stays hidden when there is no drift (markerDrift null)', () => {
    const { fixture } = makeFixture(null);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="provider-marker-drift-banner"]')).toBeNull();
  });

  it('renders the added markers joined by ", " in a <code> element', () => {
    const { fixture } = makeFixture({
      added: ['claude', 'codex'],
      removed: [],
      detected: ['claude', 'codex'],
    });
    const root = fixture.nativeElement as HTMLElement;
    const markers = root.querySelector<HTMLElement>(
      '[data-testid="provider-marker-drift-banner-markers"]',
    );
    expect(markers?.tagName).toBe('CODE');
    expect(markers?.textContent?.trim()).toBe('claude, codex');
  });

  it('emits switchLens when the Switch lens button is clicked', () => {
    const { fixture } = makeFixture({ added: ['claude'], removed: [], detected: ['claude'] });
    let emitted = 0;
    fixture.componentInstance.switchLens.subscribe(() => (emitted += 1));
    const root = fixture.nativeElement as HTMLElement;
    innerButton(root, 'provider-marker-drift-banner-switch').click();
    expect(emitted).toBe(1);
  });

  it('accepts the markers on dismiss and hides', async () => {
    const { fixture, acceptSpy } = makeFixture({
      added: ['claude'],
      removed: [],
      detected: ['claude'],
    });
    const root = fixture.nativeElement as HTMLElement;
    innerButton(root, 'provider-marker-drift-banner-dismiss').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(acceptSpy).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-testid="provider-marker-drift-banner"]')).toBeNull();
  });

  it('keeps the notice visible when the accept-markers call fails', async () => {
    const markerDrift = signal<IActiveProviderMarkerDriftApi | null>({
      added: ['claude'],
      removed: [],
      detected: ['claude'],
    });
    const acceptSpy = vi.fn().mockRejectedValue(new Error('boom'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProviderMarkerDriftBanner],
      providers: [
        {
          provide: ProjectInfoService,
          useValue: { markerDrift, acceptMarkerDrift: acceptSpy } as Partial<ProjectInfoService>,
        },
      ],
    });
    const fixture = TestBed.createComponent(ProviderMarkerDriftBanner);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    innerButton(root, 'provider-marker-drift-banner-dismiss').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(acceptSpy).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-testid="provider-marker-drift-banner"]')).not.toBeNull();
  });
});
