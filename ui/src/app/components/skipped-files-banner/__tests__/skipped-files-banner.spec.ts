import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';

import { SkippedFilesBanner } from '../skipped-files-banner';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type { IScanResultApi } from '../../../../models/api';

/**
 * Fake `CollectionLoaderService` exposing only the surface the banner
 * reads (`scanMeta()`, the corpus-wide source for skipped-for-size
 * files). Replacement keeps the test isolated from data-source wiring
 * and lets each case toggle the meta envelope explicitly.
 */
function fakeLoader(initial: IScanResultApi | null): { scanMeta: ReturnType<typeof signal<IScanResultApi | null>> } {
  return { scanMeta: signal<IScanResultApi | null>(initial) };
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

function makeFixture(
  scan: IScanResultApi | null,
  dataSource: Partial<IDataSourcePort> = {},
) {
  TestBed.resetTestingModule();
  const loader = fakeLoader(scan);
  TestBed.configureTestingModule({
    imports: [SkippedFilesBanner],
    providers: [
      { provide: CollectionLoaderService, useValue: loader },
      { provide: DATA_SOURCE, useValue: dataSource },
    ],
  });
  const fixture = TestBed.createComponent(SkippedFilesBanner);
  fixture.detectChanges();
  return { fixture, loader };
}

/** Hop the microtasks of one CTA round-trip, then re-render. */
async function settled(fixture: ReturnType<typeof makeFixture>['fixture']): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function ctaEl(fixture: ReturnType<typeof makeFixture>['fixture']): HTMLButtonElement | null {
  const root = fixture.nativeElement as HTMLElement;
  return root.querySelector<HTMLButtonElement>('[data-testid="skipped-files-banner-cta"]');
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

  it('the CTA appends every skipped file to the ignore list, root-anchored', async () => {
    const scan = emptyScan({ filesOversized: 2, oversizedFiles: oversizedFiles(2) });
    const getProjectIgnore = vi.fn().mockResolvedValue({ patterns: ['node_modules/'] });
    const setProjectIgnore = vi.fn().mockResolvedValue({ patterns: [] });
    const { fixture } = makeFixture(scan, { getProjectIgnore, setProjectIgnore });

    ctaEl(fixture)!.click();
    await settled(fixture);

    // Merge, never replace: the operator's existing patterns survive,
    // the skipped files land after them with the root anchor (a bare
    // `f1.md` would match every f1.md at any depth).
    expect(setProjectIgnore).toHaveBeenCalledWith({
      patterns: ['node_modules/', '/dir/f1.md', '/dir/f2.md'],
    });
    // Persisted: the button holds disabled until the rescan clears the
    // banner (the route restarts the watcher; a fresh scan follows).
    const cta = ctaEl(fixture)!;
    expect(cta.disabled).toBe(true);
    expect(cta.textContent?.trim()).toBe('Added, rescanning...');
  });

  it('does not duplicate a pattern the ignore list already carries', async () => {
    const scan = emptyScan({ filesOversized: 1, oversizedFiles: oversizedFiles(1) });
    const getProjectIgnore = vi.fn().mockResolvedValue({ patterns: ['/dir/f1.md'] });
    const setProjectIgnore = vi.fn().mockResolvedValue({ patterns: [] });
    const { fixture } = makeFixture(scan, { getProjectIgnore, setProjectIgnore });

    ctaEl(fixture)!.click();
    await settled(fixture);

    expect(setProjectIgnore).toHaveBeenCalledWith({ patterns: ['/dir/f1.md'] });
  });

  it('a failed write surfaces inline and re-arms the button', async () => {
    const scan = emptyScan({ filesOversized: 1, oversizedFiles: oversizedFiles(1) });
    const getProjectIgnore = vi.fn().mockRejectedValue(new Error('disk full'));
    const setProjectIgnore = vi.fn();
    const { fixture } = makeFixture(scan, { getProjectIgnore, setProjectIgnore });

    ctaEl(fixture)!.click();
    await settled(fixture);

    const root = fixture.nativeElement as HTMLElement;
    const error = root.querySelector('[data-testid="skipped-files-banner-error"]');
    expect(error?.textContent).toContain('Could not update .skillmapignore:');
    expect(error?.textContent).toContain('disk full');
    // Nothing was written, and the operator can retry.
    expect(setProjectIgnore).not.toHaveBeenCalled();
    expect(ctaEl(fixture)!.disabled).toBe(false);
  });

  it('a new skipped set re-arms a done button', async () => {
    const scan = emptyScan({ filesOversized: 1, oversizedFiles: oversizedFiles(1) });
    const getProjectIgnore = vi.fn().mockResolvedValue({ patterns: [] });
    const setProjectIgnore = vi.fn().mockResolvedValue({ patterns: [] });
    const { fixture, loader } = makeFixture(scan, { getProjectIgnore, setProjectIgnore });

    ctaEl(fixture)!.click();
    await settled(fixture);
    expect(ctaEl(fixture)!.disabled).toBe(true);

    // A later scan skips a DIFFERENT file: the banner reappears armed,
    // not frozen in the previous batch's done state.
    loader.scanMeta.set(
      emptyScan({
        filesOversized: 1,
        oversizedFiles: [{ path: 'other/big.md', bytes: 5000 }],
      }),
    );
    await settled(fixture);
    expect(ctaEl(fixture)!.disabled).toBe(false);
    expect(ctaEl(fixture)!.textContent?.trim()).toBe('Add to ignore');
  });
});
