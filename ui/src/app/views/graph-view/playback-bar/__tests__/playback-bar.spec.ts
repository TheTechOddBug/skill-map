import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';

import { PlaybackBar } from '../playback-bar';
import { ActivityPlaybackService } from '../../../../../services/activity-playback';
import { ActivityRecorderService } from '../../../../../services/activity-recorder';
import type { IPlaybackState, TPlaybackCaption } from '../../../../../services/activity-playback-state';

/**
 * Stub for `ActivityPlaybackService`: writable signals behind the real
 * read-only shape plus spied transport verbs, so the template's
 * bindings and clicks exercise the same surface production does.
 */
function makeFixture(init?: {
  total?: number;
  cursor?: number;
  playing?: boolean;
  caption?: TPlaybackCaption | null;
  dropped?: number;
}) {
  const cursor = signal(init?.cursor ?? -1);
  const playing = signal(init?.playing ?? false);
  const total = signal(init?.total ?? 3);
  const state = computed<IPlaybackState>(() => ({
    executing: new Set<string>(),
    details: new Map<string, string>(),
    members: new Set<string>(),
    invocations: [],
    spawns: [],
    coLitPairs: new Set<string>(),
    caption: init?.caption ?? null,
    virtualNowMs: 0,
  }));
  const playback = {
    active: signal(true).asReadonly(),
    cursor: cursor.asReadonly(),
    playing: playing.asReadonly(),
    total: total.asReadonly(),
    state,
    exit: vi.fn(),
    play: vi.fn(() => playing.set(true)),
    pause: vi.fn(() => playing.set(false)),
    seek: vi.fn((value: number) => cursor.set(value)),
    stepBack: vi.fn(),
    stepForward: vi.fn(),
  } as unknown as ActivityPlaybackService;
  const clear = vi.fn();
  const recorder = {
    droppedCount: signal(init?.dropped ?? 0).asReadonly(),
    size: signal(init?.total ?? 3).asReadonly(),
    clear,
  } as unknown as ActivityRecorderService;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PlaybackBar],
    providers: [
      { provide: ActivityPlaybackService, useValue: playback },
      { provide: ActivityRecorderService, useValue: recorder },
    ],
  });
  const fixture = TestBed.createComponent(PlaybackBar);
  fixture.detectChanges();
  return { fixture, playback, cursor, playing, clear };
}

function query(fixture: { nativeElement: unknown }, testid: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
}

describe('PlaybackBar', () => {
  it('renders the transport with the human 1-based counter', () => {
    const { fixture } = makeFixture({ cursor: 0, total: 3 });
    expect(query(fixture, 'graph-playback-toggle')).not.toBeNull();
    expect(query(fixture, 'graph-playback-scrubber')).not.toBeNull();
    expect(query(fixture, 'graph-playback-counter')?.textContent).toContain('1 / 3');
  });

  it('play/pause routes through the service', () => {
    const { fixture, playback } = makeFixture({ playing: false });
    (query(fixture, 'graph-playback-toggle')?.querySelector('button') as HTMLButtonElement).click();
    expect(playback.play).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    (query(fixture, 'graph-playback-toggle')?.querySelector('button') as HTMLButtonElement).click();
    expect(playback.pause).toHaveBeenCalledTimes(1);
  });

  it('the scrubber seeks by absolute cursor', () => {
    const { fixture, playback } = makeFixture({ total: 5 });
    const scrubber = query(fixture, 'graph-playback-scrubber') as HTMLInputElement;
    scrubber.value = '3';
    scrubber.dispatchEvent(new Event('input'));
    expect(playback.seek).toHaveBeenCalledWith(3);
  });

  it('exit routes through the service', () => {
    const { fixture, playback } = makeFixture();
    (query(fixture, 'graph-playback-exit')?.querySelector('button') as HTMLButtonElement).click();
    expect(playback.exit).toHaveBeenCalledTimes(1);
  });

  it('the delete shortcut drops the recording and leaves the exit to the service', () => {
    const { fixture, playback, clear } = makeFixture();
    (query(fixture, 'graph-playback-delete')?.querySelector('button') as HTMLButtonElement).click();
    expect(clear).toHaveBeenCalledTimes(1);
    // Standing the mode down is `ActivityPlaybackService`'s invariant
    // (an empty recording exits the replay wherever the delete came
    // from), NOT something each call site pairs by hand.
    expect(playback.exit).not.toHaveBeenCalled();
  });

  it('narrates the cursor event and flags a trimmed tape', () => {
    const { fixture } = makeFixture({
      cursor: 0,
      caption: { kind: 'start', path: 'docs/guide.md', detail: 'Read' },
      dropped: 7,
    });
    expect(query(fixture, 'graph-playback-caption')?.textContent).toContain('Read');
    expect(query(fixture, 'graph-playback-counter')?.textContent).toContain('*');
  });
});
