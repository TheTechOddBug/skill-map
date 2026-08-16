/** UI strings for the Live lens replay transport bar (`sm-playback-bar`). */
export const PLAYBACK_BAR_TEXTS = {
  exit: 'Exit replay',
  play: 'Play',
  pause: 'Pause',
  stepBack: 'Previous event',
  stepForward: 'Next event',
  scrubber: 'Replay position',
  /** `k / N` progress readout. */
  counter: (current: number, total: number): string => `${current} / ${total}`,
  /** Wall-clock time (local) the cursor event executed at. */
  captionTime: (hh: string, mm: string, ss: string): string => `${hh}:${mm}:${ss}`,
  timeTooltip: 'When this step executed',
  /** Elapsed from the first recorded event to the cursor event. */
  captionElapsed: (clock: string): string => `(${clock})`,
  elapsedTooltip: 'Elapsed since the start of the session',
  emptyTape: 'Nothing recorded yet',
  trimmedTape: 'Oldest events trimmed from the tape',
  scopeTooltip: 'Replaying only this slice of the recording',
  deleteRecording: 'Delete the recording',
  caption: {
    start: (name: string, detail: string | undefined): string =>
      detail === undefined ? `run ${name}` : `${detail} ${name}`,
    end: (name: string): string => `done ${name}`,
    ownerEnd: 'execution context ended',
    sessionEnd: 'session ended',
    spawn: (parent: string, child: string, phase: string): string =>
      phase === 'end' ? `${parent} finished ${child}` : `${parent} spawned ${child}`,
  },
} as const;
