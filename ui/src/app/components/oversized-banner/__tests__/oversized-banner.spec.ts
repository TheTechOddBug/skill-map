import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { OversizedBanner } from '../oversized-banner';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import type { IScanResultApi } from '../../../../models/api';

/**
 * Fake `CollectionLoaderService` exposing only the surface the banner
 * reads (`scanMeta()`). Replacement keeps the test isolated from the
 * data-source wiring and lets each case toggle the meta envelope.
 */
function fakeLoader(initial: IScanResultApi | null): {
  scanMeta: ReturnType<typeof signal<IScanResultApi | null>>;
} {
  return { scanMeta: signal<IScanResultApi | null>(initial) };
}

function meta(over: Partial<IScanResultApi>): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
    ...over,
  };
}

function makeFixture(scanMeta: IScanResultApi | null) {
  TestBed.resetTestingModule();
  const loader = fakeLoader(scanMeta);
  TestBed.configureTestingModule({
    imports: [OversizedBanner],
    providers: [{ provide: CollectionLoaderService, useValue: loader }],
  });
  const fixture = TestBed.createComponent(OversizedBanner);
  fixture.detectChanges();
  return { fixture, loader };
}

describe('OversizedBanner (scan-truncated single mode)', () => {
  it('hides when the scan was not truncated', () => {
    const { fixture } = makeFixture(meta({ scanCeiling: 1000, scanTruncated: false }));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="oversized-banner"]')).toBeNull();
  });

  it('renders the banner when scanTruncated is true', () => {
    const { fixture } = makeFixture(meta({ scanCeiling: 500, scanTruncated: true }));
    const root = fixture.nativeElement as HTMLElement;
    const banner = root.querySelector<HTMLElement>('[data-testid="oversized-banner"]');
    expect(banner).not.toBeNull();
    const body = root.querySelector<HTMLElement>('[data-testid="oversized-banner-body"]');
    expect(body?.textContent).toContain('500');
    expect(body?.textContent).toContain('ceiling');
  });

  it('hides when scanTruncated is true but scanCeiling is absent (synthetic)', () => {
    const { fixture } = makeFixture(meta({ scanTruncated: true }));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="oversized-banner"]')).toBeNull();
  });

  it('hides when the meta envelope carries no scan-truncated fields (legacy)', () => {
    const { fixture } = makeFixture(meta({}));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="oversized-banner"]')).toBeNull();
  });

  it('hides when there is no scan meta yet', () => {
    const { fixture } = makeFixture(null);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="oversized-banner"]')).toBeNull();
  });

  it('emits openSettings when the CTA is clicked', () => {
    const { fixture } = makeFixture(meta({ scanCeiling: 300, scanTruncated: true }));
    let emitted = 0;
    fixture.componentInstance.openSettings.subscribe(() => {
      emitted += 1;
    });
    const root = fixture.nativeElement as HTMLElement;
    const cta = root.querySelector<HTMLButtonElement>('[data-testid="oversized-banner-cta"]');
    expect(cta).not.toBeNull();
    cta!.click();
    expect(emitted).toBe(1);
  });
});
