/**
 * `ActivityRecorderService` unit tests: raw-frame capture with server
 * timestamps, type filtering, the Real Time gate, the oldest-first cap
 * with drop accounting, and the clear anchor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';

import type { IWsEvent } from '../../models/ws-event';
import {
  ACTIVITY_RECORDER_CAP,
  ActivityRecorderService,
} from '../activity-recorder';
import { LivePreferencesService } from '../live-preferences';
import { WsEventStreamService } from '../ws-event-stream';

const SKILL = '.claude/skills/deploy/SKILL.md';
const T0 = 1_700_000_000_000;

function activityFrame(tMs: number, nodePath = SKILL): IWsEvent {
  return {
    type: 'node.activity',
    timestamp: tMs,
    data: { nodePath, phase: 'start', owner: 'main:abc' },
  } as IWsEvent;
}

function spawnFrame(tMs: number): IWsEvent {
  return {
    type: 'agent.spawn',
    timestamp: tMs,
    data: {
      spawnId: 'toolu_01',
      phase: 'start',
      parentOwner: 'main:abc',
      parentNodePath: '.claude/agents/reviewer.md',
      childNodePath: SKILL,
    },
  } as IWsEvent;
}

function bootstrap(activityEnabled = true) {
  TestBed.resetTestingModule();
  const events$ = new Subject<IWsEvent>();
  const enabled = signal(activityEnabled);
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: { events$ } as unknown as WsEventStreamService },
      {
        provide: LivePreferencesService,
        useValue: { activityEnabled: enabled.asReadonly() } as unknown as LivePreferencesService,
      },
    ],
  });
  const service = TestBed.inject(ActivityRecorderService);
  return { service, events$, enabled };
}

async function flushed(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
}

describe('ActivityRecorderService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records activity and spawn frames with their server timestamps', async () => {
    const { service, events$ } = bootstrap();
    events$.next(activityFrame(T0 + 5));
    events$.next(spawnFrame(T0 + 9));
    await flushed();

    expect(service.size()).toBe(2);
    expect(service.events()[0]).toMatchObject({ tMs: T0 + 5, type: 'node.activity' });
    expect(service.events()[1]).toMatchObject({ tMs: T0 + 9, type: 'agent.spawn' });
  });

  it('ignores every other frame type (the scan fan-out must not flood the tape)', async () => {
    const { service, events$ } = bootstrap();
    events$.next({ type: 'scan.completed', timestamp: T0, data: {} } as IWsEvent);
    events$.next({
      type: 'scan.progress',
      timestamp: T0,
      data: { index: 1, path: SKILL, kind: 'markdown', cached: false },
    } as IWsEvent);
    events$.next(activityFrame(T0 + 1));
    await flushed();

    expect(service.size()).toBe(1);
    expect(service.events()[0]?.type).toBe('node.activity');
  });

  it('drops frames while Real Time is off', async () => {
    const { service, events$, enabled } = bootstrap(false);
    events$.next(activityFrame(T0 + 1));
    await flushed();
    expect(service.size()).toBe(0);

    enabled.set(true);
    events$.next(activityFrame(T0 + 2));
    await flushed();
    expect(service.size()).toBe(1);
  });

  it('caps the tape oldest-first and counts the drops', async () => {
    const { service, events$ } = bootstrap();
    for (let i = 0; i < ACTIVITY_RECORDER_CAP + 10; i++) {
      events$.next(activityFrame(T0 + i));
    }
    await flushed();

    expect(service.size()).toBe(ACTIVITY_RECORDER_CAP);
    expect(service.droppedCount()).toBe(10);
    // The head is the oldest SURVIVING frame.
    expect(service.events()[0]?.tMs).toBe(T0 + 10);
  });

  it('clear() drops the tape and the pending batch', async () => {
    const { service, events$ } = bootstrap();
    events$.next(activityFrame(T0 + 1));
    await flushed();
    events$.next(activityFrame(T0 + 2)); // still pending
    service.clear();
    await flushed();

    expect(service.size()).toBe(0);
    expect(service.droppedCount()).toBe(0);
  });
});
