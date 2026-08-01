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
