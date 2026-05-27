import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { OversizedBanner } from '../oversized-banner';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import type { IScanResultApi } from '../../../../models/api';

/**
 * Fake `CollectionLoaderService` exposing only the surface the banner
 * reads (`scan()`). Replacement keeps the test isolated from data-source
 * wiring and lets each case toggle the scan envelope explicitly.
 */
function fakeLoader(initial: IScanResultApi | null): { scan: ReturnType<typeof signal<IScanResultApi | null>> } {
  return { scan: signal<IScanResultApi | null>(initial) };
}

function emptyScan(over: Partial<IScanResultApi> & {
  filesWalked?: number;
  nodesCount?: number;
}): IScanResultApi {
  const { filesWalked = 0, nodesCount = 0, ...rest } = over;
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked,
      filesSkipped: 0,
      nodesCount,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
    ...rest,
  };
}

function makeFixture(scan: IScanResultApi | null) {
  TestBed.resetTestingModule();
  const loader = fakeLoader(scan);
  TestBed.configureTestingModule({
    imports: [OversizedBanner],
    providers: [{ provide: CollectionLoaderService, useValue: loader }],
  });
  const fixture = TestBed.createComponent(OversizedBanner);
  fixture.detectChanges();
  return { fixture, loader };
}

describe('OversizedBanner', () => {
  it('hides when scan is below the recommended limit', () => {
    const scan = emptyScan({
      recommendedNodeLimit: 10,
      overrideMaxNodes: null,
      filesWalked: 5,
      nodesCount: 5,
    });
    const { fixture } = makeFixture(scan);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="oversized-banner"]')).toBeNull();
  });

  it('renders in atLimit mode when nodesCount is at the recommended limit and no override', () => {
    const scan = emptyScan({
      recommendedNodeLimit: 5,
      overrideMaxNodes: null,
      filesWalked: 5,
      nodesCount: 5,
    });
    const { fixture } = makeFixture(scan);
    const root = fixture.nativeElement as HTMLElement;
    const banner = root.querySelector<HTMLElement>('[data-testid="oversized-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.dataset['mode']).toBe('atLimit');
  });

  it('renders in capped mode when filesWalked > effective cap (data dropped)', () => {
    const scan = emptyScan({
      recommendedNodeLimit: 3,
      overrideMaxNodes: null,
      filesWalked: 8,
      nodesCount: 3,
    });
    const { fixture } = makeFixture(scan);
    const root = fixture.nativeElement as HTMLElement;
    const banner = root.querySelector<HTMLElement>('[data-testid="oversized-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.dataset['mode']).toBe('capped');
  });

  it('renders in overLimit mode when an override raises the cap past the recommendation', () => {
    const scan = emptyScan({
      recommendedNodeLimit: 5,
      overrideMaxNodes: 20,
      filesWalked: 8,
      nodesCount: 8,
    });
    const { fixture } = makeFixture(scan);
    const root = fixture.nativeElement as HTMLElement;
    const banner = root.querySelector<HTMLElement>('[data-testid="oversized-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.dataset['mode']).toBe('overLimit');
  });

  it('hides when recommendedNodeLimit is absent from the envelope (legacy / synthetic)', () => {
    const scan = emptyScan({
      filesWalked: 999,
      nodesCount: 999,
    });
    const { fixture } = makeFixture(scan);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="oversized-banner"]')).toBeNull();
  });

  it('emits openSettings when the CTA is clicked', () => {
    const scan = emptyScan({
      recommendedNodeLimit: 3,
      overrideMaxNodes: null,
      filesWalked: 4,
      nodesCount: 3,
    });
    const { fixture } = makeFixture(scan);
    let emitted = 0;
    fixture.componentInstance.openSettings.subscribe(() => { emitted += 1; });
    const root = fixture.nativeElement as HTMLElement;
    const cta = root.querySelector<HTMLButtonElement>('[data-testid="oversized-banner-cta"]');
    expect(cta).not.toBeNull();
    cta!.click();
    expect(emitted).toBe(1);
  });
});
