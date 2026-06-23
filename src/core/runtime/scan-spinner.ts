/**
 * `createScanSpinner(stream, opts)`, a stream-based terminal spinner that
 * spins while a watcher scan batch runs and clears + prints a one-line
 * confirmation when it completes.
 *
 * Stream-based by design (NO `process.*`): the writable stream is
 * injected, mirroring `core/runtime/progress-emitter.ts`. This keeps the
 * spinner reusable from a test harness (a capturing fake stream) and
 * from the BFF composition root (the CLI verb hands down
 * `this.context.stderr`), and keeps `core/` free of direct process
 * reads.
 *
 * TTY vs non-TTY:
 *   - When `stream.isTTY === true`: a ~80ms `setInterval` redraws a
 *     cycling braille glyph plus the label on the same line (CR +
 *     clear-line, no trailing newline). The interval is `unref()`-ed so
 *     it never holds the Node process open on its own. The glyph is
 *     tinted cyan when `colorEnabled`.
 *   - When NOT a TTY: a single plain `Scanning...\n` line is written once
 *     on `start()` (no animation, no ANSI, grep-friendly for pipes).
 *
 * `stop(stats?)` clears the spinner line (TTY only) and prints one
 * confirmation line. With stats it appends ` · {nodes} nodes · {ms}ms`,
 * omitting whichever segment is undefined; the check glyph is tinted
 * green when `colorEnabled`. Both `start()` and `stop()` are idempotent:
 * a second `start()` while active is a no-op, and `stop()` when not
 * active writes nothing (so a spinner that never started prints no
 * confirmation line).
 *
 * Every `stream.write` is guarded so a thrown EPIPE (the operator closed
 * the pipe mid-batch) is swallowed rather than crashing the watcher.
 */

import { tx } from '../../kernel/util/tx.js';
import { SCAN_SPINNER_TEXTS } from './i18n/scan-spinner.texts.js';

/** Braille spinner frames, cycled on each interval tick. */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** Redraw cadence for the animated (TTY) spinner. */
const FRAME_INTERVAL_MS = 80;

/** Carriage return + clear-to-end-of-line, redraws the spinner in place. */
const CLEAR_LINE = '\r\x1b[2K';

const ESC_CYAN = '\x1b[36m';
const ESC_GREEN = '\x1b[32m';
const ESC_RESET = '\x1b[0m';

export interface IScanSpinnerOpts {
  /**
   * When true, the spinner glyph is tinted cyan and the completion check
   * is tinted green. When false (default), both print unstyled so
   * non-TTY pipes stay grep-friendly. The CLI verb resolves color via
   * `cli/util/serve-banner.ts: resolveColorEnabled(...)` and forwards
   * the boolean here.
   */
  colorEnabled?: boolean;
  /**
   * Override for the in-flight label. Defaults to
   * `SCAN_SPINNER_TEXTS.scanning` (`Scanning...`).
   */
  label?: string;
}

export interface IScanSpinner {
  /** Begin animating (TTY) or write the single plain line (non-TTY). A second start while active is a no-op. */
  start(): void;
  /**
   * Stop animating, clear the spinner line (TTY), and print one
   * confirmation line. `stats` segments that are undefined are omitted.
   * A no-op when the spinner is not active (never prints a stray
   * confirmation line).
   */
  stop(stats?: { nodesCount?: number; durationMs?: number } | undefined): void;
  /** True between a `start()` and its matching `stop()`. */
  readonly active: boolean;
}

export function createScanSpinner(
  stream: NodeJS.WritableStream & { isTTY?: boolean },
  opts: IScanSpinnerOpts = {},
): IScanSpinner {
  const colorEnabled = opts.colorEnabled === true;
  const label = opts.label ?? SCAN_SPINNER_TEXTS.scanning;
  const isTty = stream.isTTY === true;

  let active = false;
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Guard every write so a closed pipe (EPIPE) mid-batch is swallowed
  // rather than crashing the watcher that owns this spinner.
  const safeWrite = (chunk: string): void => {
    try {
      stream.write(chunk);
    } catch {
      // pipe closed (EPIPE) or stream already destroyed, the spinner is
      // decoration and must never take the process down with it.
    }
  };

  const tintFrame = (frame: string): string =>
    colorEnabled ? `${ESC_CYAN}${frame}${ESC_RESET}` : frame;

  const drawFrame = (): void => {
    const frame = FRAMES[frameIndex % FRAMES.length]!;
    frameIndex += 1;
    safeWrite(`${CLEAR_LINE}${tintFrame(frame)} ${label}`);
  };

  const start = (): void => {
    if (active) return;
    active = true;
    if (!isTty) {
      // Non-TTY: one plain line, no animation, no ANSI.
      safeWrite(`${label}\n`);
      return;
    }
    frameIndex = 0;
    drawFrame();
    timer = setInterval(drawFrame, FRAME_INTERVAL_MS);
    // Never let the spinner keep the process alive on its own.
    timer.unref?.();
  };

  const buildStatsSegment = (stats: {
    nodesCount?: number;
    durationMs?: number;
  }): string => {
    const segments: string[] = [];
    if (stats.nodesCount !== undefined) {
      segments.push(tx(SCAN_SPINNER_TEXTS.nodesSegment, { nodes: stats.nodesCount }));
    }
    if (stats.durationMs !== undefined) {
      segments.push(tx(SCAN_SPINNER_TEXTS.durationSegment, { durationMs: stats.durationMs }));
    }
    return segments.length > 0 ? ` · ${segments.join(' · ')}` : '';
  };

  const stop = (stats?: { nodesCount?: number; durationMs?: number } | undefined): void => {
    if (!active) return;
    active = false;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    // Clear the in-place spinner line before the confirmation (TTY only).
    if (isTty) safeWrite(CLEAR_LINE);
    const check = colorEnabled ? `${ESC_GREEN}✓${ESC_RESET}` : '✓';
    const statsSegment = stats ? buildStatsSegment(stats) : '';
    safeWrite(`${check} ${SCAN_SPINNER_TEXTS.updated}${statsSegment}\n`);
  };

  return {
    start,
    stop,
    get active(): boolean {
      return active;
    },
  };
}
