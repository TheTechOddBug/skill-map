import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SKILL_MAP_MODE, type TSkillMapMode } from '../../../../services/data-source/runtime-mode';
import { CrashReportConsentService } from '../crash-report-consent';

/**
 * CrashReportConsentService, the per-incident consent state
 * (spec/telemetry.md §Per-incident crash-report consent). Pins the
 * bounded-repetition contract: per-session dedupe by error identity, one
 * dialog at a time, demo-mode suppression, and that a decline resolves
 * without touching the SDK.
 *
 * The accept path's late `initUiSentry` is NOT exercised (it would load
 * the real `@sentry/angular` SDK in jsdom); it is covered by the dormant
 * contract in `sentry-init.spec.ts` plus manual verification, same stance
 * as that suite.
 */

function bootstrap(mode: TSkillMapMode = 'live'): CrashReportConsentService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: SKILL_MAP_MODE, useValue: mode },
    ],
  });
  return TestBed.inject(CrashReportConsentService);
}

function boom(message = 'boom'): Error {
  return new Error(message);
}

describe('CrashReportConsentService', () => {
  it('opens the dialog with the scrubbed one-line summary', () => {
    const svc = bootstrap();
    svc.offer(boom('explode'));
    expect(svc.open()).toBe(true);
    expect(svc.preview()).toContain('Error: explode');
  });

  it('collapses the configured project root out of the preview', () => {
    const svc = bootstrap();
    svc.configure({ release: null, environment: 'prod', projectRoot: '/home/a/acme-secret' });
    svc.offer(boom('failed reading /home/a/acme-secret/docs/x.md'));
    expect(svc.preview()).toContain('<PROJECT>/docs/x.md');
    expect(svc.preview()).not.toContain('acme-secret');
  });

  it('previews a truncated JSON projection for a non-Error rejection, never [object Object]', () => {
    const svc = bootstrap();
    svc.offer({ status: 500, url: 'http://localhost/api/x', message: 'Http failure' });
    expect(svc.preview()).not.toContain('[object Object]');
    expect(svc.preview()).toContain('"status":500');
  });

  it('caps the non-Error preview length (the summary stays one readable line)', () => {
    const svc = bootstrap();
    svc.offer({ big: 'y'.repeat(1000) });
    expect(svc.preview().length).toBeLessThanOrEqual(403);
    expect(svc.preview().endsWith('...')).toBe(true);
  });

  it('dedupes per session: the same error identity asks once', () => {
    const svc = bootstrap();
    const err = boom('same');
    svc.offer(err);
    void svc.resolve(false);
    expect(svc.open()).toBe(false);
    svc.offer(err);
    expect(svc.open()).toBe(false);
  });

  it('a distinct error asks again after a decline (nothing is remembered)', () => {
    const svc = bootstrap();
    svc.offer(boom('first'));
    void svc.resolve(false);
    svc.offer(boom('second'));
    expect(svc.open()).toBe(true);
  });

  it('drops errors arriving while the dialog is open (one at a time)', () => {
    const svc = bootstrap();
    svc.offer(boom('first'));
    const before = svc.preview();
    svc.offer(boom('second'));
    expect(svc.preview()).toBe(before);
    // The dropped error was never marked seen through the open-dialog
    // guard path only when identical; a distinct one may ask later.
  });

  it('demo mode is fully suppressed', () => {
    const svc = bootstrap('demo');
    svc.offer(boom('demo boom'));
    expect(svc.open()).toBe(false);
  });

  it('never offers a module-load failure (server gone / stale cached shell), any browser phrasing', () => {
    const svc = bootstrap();
    svc.offer(
      new TypeError(
        'Failed to fetch dynamically imported module: http://localhost:4200/@ng/component?c=x',
      ),
    );
    expect(svc.open()).toBe(false);
    svc.offer(new TypeError('error loading dynamically imported module: http://localhost:4200/x'));
    expect(svc.open()).toBe(false);
    svc.offer(new TypeError('Importing a module script failed.'));
    expect(svc.open()).toBe(false);
  });

  it('a genuine error still asks after a suppressed module-load failure', () => {
    const svc = bootstrap();
    svc.offer(new TypeError('Failed to fetch dynamically imported module: http://localhost:4200/x'));
    expect(svc.open()).toBe(false);
    svc.offer(boom('real defect'));
    expect(svc.open()).toBe(true);
  });

  it('a decline resolves cleanly and clears the pending state', async () => {
    const svc = bootstrap();
    svc.offer(boom('to-decline'));
    await svc.resolve(false);
    expect(svc.open()).toBe(false);
  });

  it('scrubs home paths out of the preview', () => {
    const svc = bootstrap();
    svc.offer(boom('failed reading /home/alice/notes.md'));
    expect(svc.preview()).not.toContain('alice');
  });
});
