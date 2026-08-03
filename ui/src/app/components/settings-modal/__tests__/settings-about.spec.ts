import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { SettingsAbout } from '../settings-about';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { ThemeService } from '../../../../services/theme';
import type { IHealthResponseApi } from '../../../../models/api';

/**
 * SettingsAbout coverage. The section shows version + project info; the
 * health payload is fetched lazily the first time `visible()` flips true
 * (`GET /api/health`). The spec exercises:
 *   - the logo binds through `[ngSrc]` (NgOptimizedImage) and flips with
 *     the resolved theme via the `markSrc` computed (dark -> light mark,
 *     light -> dark mark), mirroring the topbar logo's optimized path.
 *   - the health endpoint is NOT hit while the section is hidden, and is
 *     hit exactly once when it becomes visible.
 *   - the DB row renders the path relative to `cwd` when the DB lives
 *     under the project folder, and the absolute path otherwise
 *     (the `relativeToCwd` helper, observed through `dbDisplay`).
 *   - a failed load surfaces through the error row without throwing.
 *
 * The data-source is stubbed. `ThemeService` and `UpdateCheckService`
 * are `providedIn: 'root'`; the former self-provides against the jsdom
 * `DOCUMENT`, the latter only needs the stubbed `DATA_SOURCE` and is
 * never asked to fetch here (its `load()` is an `App.ngOnInit` concern),
 * so no extra providers are needed.
 */

function health(overrides: Partial<IHealthResponseApi> = {}): IHealthResponseApi {
  return {
    ok: true,
    schemaVersion: '7',
    specVersion: '0.40.0',
    implVersion: '0.41.0',
    db: 'present',
    cwd: '~/projects/demo',
    dbPath: '~/projects/demo/.skill-map/skill-map.db',
    mcp: false,
    ...overrides,
  };
}

function bootstrap(
  stub: Partial<IDataSourcePort>,
  theme?: 'light' | 'dark',
): ComponentFixture<SettingsAbout> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
    ],
  });
  if (theme) TestBed.inject(ThemeService).set(theme);
  const fixture = TestBed.createComponent(SettingsAbout);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  return fixture;
}

function logo(fixture: ComponentFixture<SettingsAbout>): HTMLImageElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="settings-about-logo"]',
  );
  if (!el) throw new Error('SettingsAbout did not render the logo');
  return el as HTMLImageElement;
}

// Hop through two microtasks so the `effect` that lazily calls `load()`
// resolves and the `health` signal is populated before assertions.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SettingsAbout, logo binding', () => {
  it('serves the light mark through [ngSrc] in dark mode (NgOptimizedImage)', () => {
    const fixture = bootstrap({ health: vi.fn().mockResolvedValue(health()) }, 'dark');
    const img = logo(fixture);
    // NgOptimizedImage processed the binding into the `src` attribute
    // (the directive owns it; no co-existing plain `[src]`).
    expect(img.getAttribute('src')).toContain('skill-map-mark-light.svg');
    // Decorative + sized, so the optimized image directive stays happy
    // and screen readers skip it.
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('width')).toBe('64');
    expect(img.getAttribute('height')).toBe('64');
  });

  it('serves the dark mark through [ngSrc] in light mode', () => {
    const fixture = bootstrap({ health: vi.fn().mockResolvedValue(health()) }, 'light');
    expect(logo(fixture).getAttribute('src')).toContain('skill-map-mark-dark.svg');
  });
});

describe('SettingsAbout, lazy health load', () => {
  it('does not fetch health while the section is hidden', () => {
    const healthFn = vi.fn().mockResolvedValue(health());
    bootstrap({ health: healthFn });
    expect(healthFn).not.toHaveBeenCalled();
  });

  it('fetches health exactly once when the section becomes visible', async () => {
    const healthFn = vi.fn().mockResolvedValue(health());
    const fixture = bootstrap({ health: healthFn });

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    expect(healthFn).toHaveBeenCalledTimes(1);
    const dom = fixture.nativeElement as HTMLElement;
    expect(dom.querySelector('[data-testid="settings-about-cli"]')?.textContent).toContain(
      '0.41.0',
    );
    expect(dom.querySelector('[data-testid="settings-about-spec"]')?.textContent).toContain(
      '0.40.0',
    );
  });

  it('renders the DB path relative to cwd when the DB lives under the project folder', async () => {
    const fixture = bootstrap({ health: vi.fn().mockResolvedValue(health({ db: 'present' })) });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const dbCell = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="settings-about-db"]',
    );
    // `present` collapses to the bare relative path (no `<state> ·` prefix).
    expect(dbCell?.textContent?.trim()).toBe('.skill-map/skill-map.db');
  });

  it('keeps the absolute DB path when the DB lives outside cwd', async () => {
    const fixture = bootstrap({
      health: vi.fn().mockResolvedValue(
        health({ db: 'missing', dbPath: '~/other/place/skill-map.db' }),
      ),
    });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const dbCell = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="settings-about-db"]',
    );
    // Outside cwd, the path is left intact, and `missing` keeps its prefix.
    expect(dbCell?.textContent).toContain('~/other/place/skill-map.db');
    expect(dbCell?.textContent).toContain('missing');
  });

  it('surfaces a failed load through the error row without throwing', async () => {
    const fixture = bootstrap({
      health: vi.fn().mockRejectedValue(new DataSourceError('demo-readonly', 'no health here')),
    });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const errorRow = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="settings-about-error"]',
    );
    expect(errorRow?.textContent).toContain('no health here');
  });
});

/**
 * Star count inside the existing "Enjoying skill-map?" CTA (user
 * decision 2026-08-03, placement 4). It is social proof ON the ask, not
 * an ask of its own, which is why it renders inside the button and why
 * its absence leaves the card intact.
 */
describe('SettingsAbout star count', () => {
  it('renders the count inside the CTA when one is known', async () => {
    const fixture = bootstrap({
      health: vi.fn().mockResolvedValue(health()),
      getGithubStars: vi.fn().mockResolvedValue({ count: 27, checkedAt: 1 }),
    } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const badge = root.querySelector('[data-testid="settings-about-star-count"]');
    expect(badge?.textContent?.trim()).toBe('27');
    // Inside the CTA, not floating next to it.
    expect(badge?.closest('.settings-about__star-cta')).not.toBeNull();
  });

  it('leaves the CTA whole when the count is unknown', async () => {
    const fixture = bootstrap({
      health: vi.fn().mockResolvedValue(health()),
      getGithubStars: vi.fn().mockResolvedValue({ count: null, checkedAt: null }),
    } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="settings-about-star-count"]')).toBeNull();
    // The card still asks for the star; only the number is missing.
    expect(root.querySelector('[data-testid="settings-about-star"]')).not.toBeNull();
  });
});
