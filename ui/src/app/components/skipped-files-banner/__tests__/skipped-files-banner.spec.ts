import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';

import { SkippedFilesBanner } from '../skipped-files-banner';
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

/**
 * Build N synthetic skipped-file entries (`f1.md`, `f2.md`, ...). Byte
 * size scales with the index so each entry is distinguishable.
 */
function oversizedFiles(n: number): { path: string; bytes: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `dir/f${i + 1}.md`,
    bytes: (i + 1) * 1000,
  }));
}

function emptyScan(over: Partial<IScanResultApi> & {
  filesOversized?: number;
}): IScanResultApi {
  const { filesOversized, oversizedFiles: files, stats, ...rest } = over;
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    nodes: [],
    links: [],
    issues: [],
    oversizedFiles: files,
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
      filesOversized,
      ...stats,
    },
    ...rest,
  };
}

function makeFixture(scan: IScanResultApi | null) {
  TestBed.resetTestingModule();
  const loader = fakeLoader(scan);
  TestBed.configureTestingModule({
    imports: [SkippedFilesBanner],
    providers: [{ provide: CollectionLoaderService, useValue: loader }],
  });
  const fixture = TestBed.createComponent(SkippedFilesBanner);
  fixture.detectChanges();
  return { fixture, loader };
}

function bannerEl(fixture: ReturnType<typeof makeFixture>['fixture']): HTMLElement | null {
  const root = fixture.nativeElement as HTMLElement;
  return root.querySelector<HTMLElement>('[data-testid="skipped-files-banner"]');
}

function moreEl(fixture: ReturnType<typeof makeFixture>['fixture']): HTMLElement | null {
  const root = fixture.nativeElement as HTMLElement;
  return root.querySelector<HTMLElement>('[data-testid="skipped-files-banner-more"]');
}

/**
 * Read the bound `pTooltip` value off the PrimeNG `Tooltip` directive
 * instance on the `...` affordance. Reading the directive (rather than
 * an `ng-reflect-*` attribute, which is dev-mode-only) keeps the
 * assertion deterministic in the unit-test build.
 */
function moreTooltip(fixture: ReturnType<typeof makeFixture>['fixture']): string | null {
  const de = fixture.debugElement.query(By.css('[data-testid="skipped-files-banner-more"]'));
  if (!de) return null;
  const content = de.injector.get(Tooltip).content;
  return typeof content === 'string' ? content : null;
}

describe('SkippedFilesBanner', () => {
  it('hides when no scan is loaded', () => {
    const { fixture } = makeFixture(null);
    expect(bannerEl(fixture)).toBeNull();
  });

  it('hides when count is 0 (no files skipped for size)', () => {
    const scan = emptyScan({ filesOversized: 0, oversizedFiles: [] });
    const { fixture } = makeFixture(scan);
    expect(bannerEl(fixture)).toBeNull();
  });

  it('shows inline-only (no ... affordance) when exactly one file was skipped', () => {
    const scan = emptyScan({ filesOversized: 1, oversizedFiles: oversizedFiles(1) });
    const { fixture } = makeFixture(scan);
    const banner = bannerEl(fixture);
    expect(banner).not.toBeNull();
    // First offender named as `name (humanSize)` (basename + compactNumber).
    const first = banner!.querySelector<HTMLElement>('[data-testid="skipped-files-banner-first"]');
    expect(first?.textContent?.trim()).toBe('f1.md (1k)');
    // No trailing affordance with a single file.
    expect(moreEl(fixture)).toBeNull();
  });

  it('lists the remaining files in the tooltip when 2..6 files were skipped', () => {
    // count = 6 -> rest = 5 (== MAX_REST_ENUMERATED), still enumerated.
    const scan = emptyScan({ filesOversized: 6, oversizedFiles: oversizedFiles(6) });
    const { fixture } = makeFixture(scan);
    expect(moreEl(fixture)).not.toBeNull();
    // The "rest" is files after the first: f2..f6, one per line.
    expect(moreTooltip(fixture)).toBe('f2.md (2k)\nf3.md (3k)\nf4.md (4k)\nf5.md (5k)\nf6.md (6k)');
  });

  it('lists the rest in the tooltip when exactly two files were skipped', () => {
    const scan = emptyScan({ filesOversized: 2, oversizedFiles: oversizedFiles(2) });
    const { fixture } = makeFixture(scan);
    expect(moreEl(fixture)).not.toBeNull();
    expect(moreTooltip(fixture)).toBe('f2.md (2k)');
  });

  it('shows the console message in the tooltip when count > 6 (rest > 5)', () => {
    const scan = emptyScan({ filesOversized: 7, oversizedFiles: oversizedFiles(7) });
    const { fixture } = makeFixture(scan);
    expect(moreEl(fixture)).not.toBeNull();
    expect(moreTooltip(fixture)).toBe('See the full list in the console.');
  });

  it('falls back to oversizedFiles.length when filesOversized stat is absent', () => {
    const scan = emptyScan({ oversizedFiles: oversizedFiles(2) });
    const { fixture } = makeFixture(scan);
    expect(bannerEl(fixture)).not.toBeNull();
    expect(moreEl(fixture)).not.toBeNull();
  });

  it('emits openSettings when the CTA is clicked', () => {
    const scan = emptyScan({ filesOversized: 1, oversizedFiles: oversizedFiles(1) });
    const { fixture } = makeFixture(scan);
    let emitted = 0;
    fixture.componentInstance.openSettings.subscribe(() => { emitted += 1; });
    const root = fixture.nativeElement as HTMLElement;
    const cta = root.querySelector<HTMLButtonElement>('[data-testid="skipped-files-banner-cta"]');
    expect(cta).not.toBeNull();
    cta!.click();
    expect(emitted).toBe(1);
  });
});
