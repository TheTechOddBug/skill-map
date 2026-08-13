/**
 * `ActivityPlaybackService` transport tests: the frozen tape, the
 * 1 event/sec stepper, auto-pause at the end, replay-from-end, and
 * scrubbing. Fake timers; the recorder is stubbed to a plain signal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ActivityPlaybackService, PLAYBACK_STEP_MS } from '../activity-playback';
import { ActivityRecorderService, type TRecordedEvent } from '../activity-recorder';
import type { IWsNodeActivityData } from '../../models/ws-event';

const T0 = 1_700_000_000_000;
const SKILL = '.claude/skills/deploy/SKILL.md';

function frame(tMs: number, nodePath: string): TRecordedEvent {
  return {
    tMs,
    type: 'node.activity',
    data: { nodePath, phase: 'start', owner: 'a' } as IWsNodeActivityData,
  };
}

function bootstrap(initial: TRecordedEvent[] = []) {
  TestBed.resetTestingModule();
  const events = signal<readonly TRecordedEvent[]>(initial);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ActivityRecorderService,
        useValue: { events: events.asReadonly() } as unknown as ActivityRecorderService,
      },
    ],
  });
  const service = TestBed.inject(ActivityPlaybackService);
  return { service, events };
}

const TAPE = [frame(T0, SKILL), frame(T0 + 500, 'b.md'), frame(T0 + 900, 'c.md')];

describe('ActivityPlaybackService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enter snapshots the tape, rewinds, and auto-plays one event per second', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    expect(service.active()).toBe(true);
    expect(service.playing()).toBe(true);
    expect(service.cursor()).toBe(-1);
    expect(service.total()).toBe(3);

    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(0);
    expect(service.state().executing.has(SKILL)).toBe(true);

    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(1);
  });

  it('auto-pauses on the last event and play() from the end restarts', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 5);
    expect(service.cursor()).toBe(2);
    expect(service.playing()).toBe(false);

    service.play();
    expect(service.cursor()).toBe(-1); // watch it again
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(0);
  });

  it('pause holds the cursor; play resumes from there', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    service.pause();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 3);
    expect(service.cursor()).toBe(0);

    service.play();
    vi.advanceTimersByTime(PLAYBACK_STEP_MS);
    expect(service.cursor()).toBe(1);
  });

  it('live frames recorded mid-replay never shift the frozen tape', () => {
    const { service, events } = bootstrap(TAPE);
    service.enter();
    events.set([...TAPE, frame(T0 + 2000, 'late.md')]);
    expect(service.total()).toBe(3);

    // A fresh enter picks the newer tape up.
    service.exit();
    service.enter();
    expect(service.total()).toBe(4);
  });

  it('seek clamps and stepBack/stepForward move one event', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    service.pause();
    service.seek(99);
    expect(service.cursor()).toBe(2);
    service.seek(-5);
    expect(service.cursor()).toBe(-1);
    service.stepForward();
    expect(service.cursor()).toBe(0);
    service.stepBack();
    expect(service.cursor()).toBe(-1);
  });

  it('exit stops the stepper and drops the tape', () => {
    const { service } = bootstrap(TAPE);
    service.enter();
    service.exit();
    expect(service.active()).toBe(false);
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 3);
    expect(service.cursor()).toBe(-1);
    expect(service.total()).toBe(0);
  });

  it('entering with an empty tape stays inert (nothing to play)', () => {
    const { service } = bootstrap([]);
    service.enter();
    expect(service.active()).toBe(true);
    expect(service.playing()).toBe(false);
    vi.advanceTimersByTime(PLAYBACK_STEP_MS * 2);
    expect(service.cursor()).toBe(-1);
  });
});
