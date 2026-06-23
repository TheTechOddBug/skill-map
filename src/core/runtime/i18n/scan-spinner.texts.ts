/**
 * Strings emitted by `core/runtime/scan-spinner.ts`.
 *
 * The spinner spins on a TTY while a watcher scan batch runs (file save
 * to server re-scan) and clears + prints a one-line confirmation when it
 * completes. On a non-TTY stream it degrades to a single plain
 * `Scanning...` line and a plain confirmation line (pipe-friendly, no
 * animation, no ANSI).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation. Plural /
 * conditional logic stays out of the template, the caller composes the
 * `stats` segment upstream and passes the finished string.
 */

export const SCAN_SPINNER_TEXTS = {
  /**
   * Animated (TTY) / single-line (non-TTY) label shown while a batch is
   * in flight. No em dash, the trailing ellipsis is three ASCII dots.
   */
  scanning: 'Scanning...',

  /**
   * Headline word for the completion line, framed by the caller as
   * `{{glyph}} {{updated}}` (+ optional ` · {{stats}}` segment).
   */
  updated: 'Map updated',

  /**
   * Optional stats segment appended after the headline when the batch
   * outcome carried `nodesCount` / `durationMs`. The caller composes
   * whichever of `{{nodes}}` / `{{durationMs}}` were defined and joins
   * them with the middle-dot separator before passing the finished line.
   */
  nodesSegment: '{{nodes}} nodes',
  durationSegment: '{{durationMs}}ms',
} as const;
