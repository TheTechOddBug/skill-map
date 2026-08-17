/**
 * `SessionPurgeService`: one gesture, both memories (user decision
 * 2026-08-16). The tape clear is synchronous and unconditional; the
 * journal wipe is best-effort (demo mode / dead server must never
 * block erasing the local tape).
 */

import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ActivityRecorderService } from '../activity-recorder';
import { DATA_SOURCE } from '../data-source/data-source.port';
import { SessionPurgeService } from '../session-purge';

function bootstrap(journalRejects = false) {
  const clear = vi.fn();
  const clearSessionJournal = journalRejects
    ? vi.fn().mockRejectedValue(new Error('demo-readonly'))
    : vi.fn().mockResolvedValue(undefined);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ActivityRecorderService, useValue: { clear } },
      { provide: DATA_SOURCE, useValue: { clearSessionJournal } },
    ],
  });
  return { service: TestBed.inject(SessionPurgeService), clear, clearSessionJournal };
}

describe('SessionPurgeService', () => {
  it('erases the tape AND asks the server to wipe the journal', () => {
    const { service, clear, clearSessionJournal } = bootstrap();
    service.purge();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clearSessionJournal).toHaveBeenCalledTimes(1);
  });

  it('a rejected journal wipe never blocks the local erase', async () => {
    const { service, clear } = bootstrap(true);
    service.purge();
    // Let the rejection settle: no unhandled rejection, tape cleared.
    await Promise.resolve();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
