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
  emptyTape: 'Nothing recorded yet',
  trimmedTape: 'Oldest events trimmed from the tape',
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
