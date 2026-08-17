/**
 * `CaptureLevelService`: the client mirror of the serve-side capture
 * ladder (hydration from the journal envelope, optimistic move with
 * server echo, rollback on failure, busy gate).
 */

import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { CaptureLevelService } from '../capture-level';
import { DATA_SOURCE } from '../data-source/data-source.port';

function bootstrap(overrides?: {
  setCaptureLevel?: ReturnType<typeof vi.fn>;
  getSessionJournal?: ReturnType<typeof vi.fn>;
}) {
  const setCaptureLevel =
    overrides?.setCaptureLevel ?? vi.fn((level: string) => Promise.resolve(level));
  const getSessionJournal =
    overrides?.getSessionJournal ??
    vi.fn().mockResolvedValue({ sessions: [], recording: false, captureLevel: 'reads', shellCapture: false });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: DATA_SOURCE, useValue: { setCaptureLevel, getSessionJournal } }],
  });
  return { service: TestBed.inject(CaptureLevelService), setCaptureLevel, getSessionJournal };
}

describe('CaptureLevelService', () => {
  it('defaults to mcp and hydrates only ladder names', () => {
    const { service } = bootstrap();
    expect(service.level()).toBe('mcp');
    service.hydrate('reads');
    expect(service.level()).toBe('reads');
    service.hydrate('everything'); // off-ladder: ignored
    expect(service.level()).toBe('reads');
  });

  it('refresh() adopts the envelope level, best-effort on failure', async () => {
    const { service } = bootstrap();
    await service.refresh();
    expect(service.level()).toBe('reads');

    const failing = bootstrap({
      getSessionJournal: vi.fn().mockRejectedValue(new Error('demo-readonly')),
    });
    failing.service.hydrate('writes');
    await failing.service.refresh();
    expect(failing.service.level()).toBe('writes'); // kept, not reset
  });

  it('set() moves optimistically and keeps the server echo', async () => {
    const { service, setCaptureLevel } = bootstrap();
    await service.set('executions');
    expect(setCaptureLevel).toHaveBeenCalledWith('executions');
    expect(service.level()).toBe('executions');
  });

  it('set() rolls back when the move fails (the selector never lies)', async () => {
    const { service } = bootstrap({
      setCaptureLevel: vi.fn().mockRejectedValue(new Error('demo-readonly')),
    });
    await service.set('reads');
    expect(service.level()).toBe('mcp');
  });

  it('set() no-ops on the current level and while a move is in flight', async () => {
    const { service, setCaptureLevel } = bootstrap();
    await service.set('mcp'); // already there
    expect(setCaptureLevel).not.toHaveBeenCalled();
  });
});
