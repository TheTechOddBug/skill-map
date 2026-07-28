/**
 * `createScanSpinner` unit tests.
 *
 * Exercises the spinner against a capturing fake stream (no `process.*`,
 * no real terminal) plus `node:test`'s `mock.timers` for the animated
 * TTY path. Mirrors the fake-stream style of
 * `core/runtime/__tests__/progress-emitter.spec.ts` and the fake-timer
 * style of `server/__tests__/server-ws-heartbeat.spec.ts`.
 *
 * Coverage targets:
 *   - TTY: `start()` + ticking the timer writes braille frames; `stop()`
 *     with stats clears and writes a line carrying the counts; a second
 *     `stop()` is a no-op.
 *   - Non-TTY: `start()` writes one plain `Scanning` line (no timer);
 *     `stop()` writes the confirmation line.
 *   - `stop()` without `start()` writes nothing.
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createScanSpinner } from '../scan-spinner.js';

/** Capturing writable: records every chunk written, never a real TTY. */
class CaptureStream {
  chunks: string[] = [];
  constructor(public isTTY = false) {}
  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
}

/** The braille frames the TTY spinner cycles through. */
const BRAILLE_RE = /[⠀-⣿]/;

describe('createScanSpinner', () => {
  describe('TTY stream', () => {
    beforeEach(() => {
      mock.timers.enable({ apis: ['setInterval'] });
    });

    afterEach(() => {
      mock.timers.reset();
      mock.restoreAll();
    });

    it('animates braille frames after start() and clears + confirms on stop()', () => {
      const stream = new CaptureStream(true);
      const spinner = createScanSpinner(stream as unknown as NodeJS.WritableStream & { isTTY?: boolean });

      spinner.start();
      assert.equal(spinner.active, true);
      // Initial draw plus a few interval ticks.
      mock.timers.tick(80);
      mock.timers.tick(80);
      assert.match(stream.text, BRAILLE_RE, 'a braille glyph was drawn');

      spinner.stop({ nodesCount: 3, durationMs: 42 });
      assert.equal(spinner.active, false);
      // Confirmation line carries both stats and ends with a newline.
      assert.match(stream.text, /3 nodes/);
      assert.match(stream.text, /42ms/);
      assert.match(stream.text, /\n$/);
      // The clear-line escape was emitted so the spinner row is wiped.
      assert.ok(stream.text.includes('\x1b[2K'), 'clear-line escape present');
    });

    it('treats a second start() while active as a no-op', () => {
      const stream = new CaptureStream(true);
      const spinner = createScanSpinner(stream as unknown as NodeJS.WritableStream & { isTTY?: boolean });
      spinner.start();
      mock.timers.tick(80);
      const before = stream.chunks.length;
      spinner.start(); // no-op, must not re-seed a second interval.
      const after = stream.chunks.length;
      assert.equal(after, before, 'second start() wrote nothing');
      spinner.stop();
    });

    it('a second stop() is a no-op (no duplicate confirmation line)', () => {
      const stream = new CaptureStream(true);
      const spinner = createScanSpinner(stream as unknown as NodeJS.WritableStream & { isTTY?: boolean });
      spinner.start();
      mock.timers.tick(80);
      spinner.stop({ nodesCount: 1 });
      const firstStopText = stream.text;
      spinner.stop({ nodesCount: 99 });
      assert.equal(stream.text, firstStopText, 'second stop() wrote nothing');
    });
  });

  describe('non-TTY stream', () => {
    it('start() writes a single plain Scanning line (no animation)', () => {
      const stream = new CaptureStream(false);
      const spinner = createScanSpinner(stream as unknown as NodeJS.WritableStream & { isTTY?: boolean });
      spinner.start();
      assert.equal(stream.text, 'Scanning...\n');
      // No ANSI escapes on a non-TTY stream.
      assert.ok(!stream.text.includes('\x1b['), 'no ANSI on non-TTY');
    });

    it('stop() writes the confirmation line', () => {
      const stream = new CaptureStream(false);
      const spinner = createScanSpinner(stream as unknown as NodeJS.WritableStream & { isTTY?: boolean });
      spinner.start();
      spinner.stop({ nodesCount: 7, durationMs: 12 });
      assert.match(stream.text, /Map updated/);
      assert.match(stream.text, /7 nodes/);
      assert.match(stream.text, /12ms/);
      // No clear-line escape on a non-TTY stream.
      assert.ok(!stream.text.includes('\x1b[2K'), 'no clear-line on non-TTY');
    });

    it('omits stats segments that are undefined', () => {
      const stream = new CaptureStream(false);
      const spinner = createScanSpinner(stream as unknown as NodeJS.WritableStream & { isTTY?: boolean });
      spinner.start();
      stream.chunks.length = 0; // drop the Scanning line, focus on stop()
      spinner.stop({ nodesCount: 5 });
      assert.match(stream.text, /5 nodes/);
      assert.ok(!/ms/.test(stream.text), 'no duration segment when undefined');
    });
  });

  it('stop() without start() writes nothing', () => {
    const stream = new CaptureStream(true);
    const spinner = createScanSpinner(stream as unknown as NodeJS.WritableStream & { isTTY?: boolean });
    spinner.stop({ nodesCount: 3, durationMs: 42 });
    assert.equal(stream.text, '', 'no confirmation when never started');
    assert.equal(spinner.active, false);
  });

  it('tints the glyph + check when colorEnabled', () => {
    const stream = new CaptureStream(true);
    const spinner = createScanSpinner(
      stream as unknown as NodeJS.WritableStream & { isTTY?: boolean },
      { colorEnabled: true },
    );
    spinner.start();
    spinner.stop();
    // Cyan frame (\x1b[36m) during animation, green check (\x1b[32m) on stop.
    assert.ok(stream.text.includes('\x1b[36m'), 'cyan frame escape present');
    assert.ok(stream.text.includes('\x1b[32m'), 'green check escape present');
  });
});
