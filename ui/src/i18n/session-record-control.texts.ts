/** UI strings for the shared record/stop/exit control (`sm-session-record-control`). */
export const SESSION_RECORD_CONTROL_TEXTS = {
  /**
   * The record control (user decision 2026-08-16): recording is a
   * deliberate gesture, never ambient. The tape captures ONLY between
   * Record and Stop; Real Time keeps the live map glow regardless.
   */
  start: 'Record session',
  stop: 'Stop recording',
  startTooltip: 'Capture a new session and watch it live on the map',
  stopTooltip: 'Stop capturing; the recording stays in Sessions, ready to replay',
  unavailableTooltip: 'Recording needs Real Time on and the live map available',
  /** Dim status beside the blinking dot while capturing. */
  liveHint: 'Recording…',
  /**
   * While a replay runs, the same control becomes its stop (user call
   * 2026-08-16): recording and replaying are exclusive gestures, so
   * the one button always offers the way out of whichever is on, and
   * the two stop faces deliberately MIRROR each other (same stop
   * glyph, same dot + status anatomy), amber vs broadcast red.
   */
  stopReplay: 'Stop replay',
  stopReplayTooltip: 'Leave the replay and return to the map',
  /** Dim status beside the amber dot while a replay narrates. */
  replayHint: 'Replaying…',
} as const;
