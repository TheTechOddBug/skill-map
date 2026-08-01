/**
 * Coverage for the CLI logger's `defaultFormat` + `Logger` paint
 * pipeline. The formatter renders the per-level glyph and label
 * through an `IAnsi` helper resolved from the stream's `isTTY`,
 * matching the project-wide output style (see
 * `context/cli-output-style.md` §Glyph catalog). Without these tests
 * any future refactor of the formatter could change how every
 * `WARN` / `ERROR` line looks across the whole CLI without any
 * unit-level signal.
 *
 * Each case exercises ONE invariant of the pipeline:
 *   - level → glyph mapping (`✕ ERROR`, `⚠ WARN`, `ℹ INFO`, `· DEBUG`,
 *     `· TRACE`).
 *   - paint helper is opt-in: a non-TTY stream gets the no-op `IAnsi`,
 *     so the glyph bytes still print but no ANSI escapes.
 *   - level filtering via `setLevel` short-circuits emits below the
 *     configured threshold.
 *   - `noColorFlag` overrides TTY detection.
 *   - custom formatter receives the resolved `IAnsi` for parity.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Logger, defaultFormat } from '../logger.js';
import type { IAnsi } from '../ansi.js';
import type { LogRecord } from '../../../kernel/ports/logger.js';

interface ICapturedStream {
  stream: NodeJS.WritableStream;
  read: () => string;
  setTty: (value: boolean) => void;
}

/**
 * Lightweight writable shim. Exposes an `isTTY` switch so a single
 * test can flip between the painted and bare paths without touching
 * process.stderr.
 */
function captureStream(opts: { isTTY?: boolean } = {}): ICapturedStream {
  const chunks: string[] = [];
  const stream: NodeJS.WritableStream & { isTTY?: boolean } = {
    isTTY: opts.isTTY === true,
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
  } as unknown as NodeJS.WritableStream & { isTTY?: boolean };
  return {
    stream,
    read: () => chunks.join(''),
    setTty: (value: boolean) => {
      (stream as { isTTY?: boolean }).isTTY = value;
    },
  };
}

/** ANSI escape constants mirroring `cli/util/ansi.ts`. */
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[38;5;203m',
  yellow: '\x1b[38;5;214m',
  cyan: '\x1b[38;5;81m',
} as const;

const FIXED_ISO = '2026-05-25T20:00:00.000Z';

function localTimeFromIso(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const FIXED_TIME = localTimeFromIso(FIXED_ISO);

function mkRecord(over: Partial<LogRecord>): LogRecord {
  return {
    level: 'warn',
    timestamp: FIXED_ISO,
    message: 'msg',
    ...over,
  } as LogRecord;
}

describe('Logger, defaultFormat', () => {
  it('error → red ✕ ERROR + message', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.error('boom');
    const out = cap.read();
    // Painted glyph + label + message; both glyph and label share the
    // red escape but emit separately so each wraps its own reset.
    assert.ok(out.includes(`${ANSI.red}✕${ANSI.reset}`), `glyph painted red: ${JSON.stringify(out)}`);
    assert.ok(out.includes(`${ANSI.red}ERROR${ANSI.reset}`), `label painted red: ${JSON.stringify(out)}`);
    assert.ok(out.includes('boom'));
    assert.ok(out.endsWith('\n'), 'formatter appends its own newline');
  });

  it('warn → yellow ⚠ WARN + message', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.warn('careful');
    const out = cap.read();
    assert.ok(out.includes(`${ANSI.yellow}⚠${ANSI.reset}`));
    assert.ok(out.includes(`${ANSI.yellow}WARN ${ANSI.reset}`));
    assert.ok(out.includes('careful'));
  });

  it('info → cyan ℹ INFO + message', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.info('hi');
    const out = cap.read();
    assert.ok(out.includes(`${ANSI.cyan}ℹ${ANSI.reset}`));
    assert.ok(out.includes(`${ANSI.cyan}INFO ${ANSI.reset}`));
    assert.ok(out.includes('hi'));
  });

  it('debug → dim · DEBUG (no colour, just dim)', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.debug('inner');
    const out = cap.read();
    assert.ok(out.includes(`${ANSI.dim}·${ANSI.reset}`));
    assert.ok(out.includes(`${ANSI.dim}DEBUG${ANSI.reset}`));
    assert.ok(out.includes('inner'));
  });

  it('trace → dim · TRACE', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.trace('deep');
    const out = cap.read();
    assert.ok(out.includes(`${ANSI.dim}·${ANSI.reset}`));
    assert.ok(out.includes(`${ANSI.dim}TRACE${ANSI.reset}`));
    assert.ok(out.includes('deep'));
  });

  it('non-TTY stream falls back to bare glyphs (no ANSI escapes), label still padded', () => {
    const cap = captureStream({ isTTY: false });
    // Pass a clean env so a `FORCE_COLOR=1` developer shell does not
    // flip the non-TTY assertion; the precedence rule itself is
    // covered separately in `ansi.spec.ts`.
    const log = new Logger({ level: 'trace', stream: cap.stream, env: {} });
    log.warn('plain');
    const out = cap.read();
    // No escape codes anywhere on the line.
    assert.equal(out.includes('\x1b['), false, `unexpected escape in non-TTY output: ${JSON.stringify(out)}`);
    // Glyph bytes + label still emitted; the label keeps its 5-char
    // padding so columns align across levels.
    assert.ok(out.includes('⚠ WARN '), `bare glyph + padded label expected: ${JSON.stringify(out)}`);
    assert.ok(out.includes('plain'));
  });

  it('noColorFlag: true forces the no-op ansi even on a TTY', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream, noColorFlag: true });
    log.error('still plain');
    const out = cap.read();
    assert.equal(out.includes('\x1b['), false, `--no-color must strip every escape: ${JSON.stringify(out)}`);
    assert.ok(out.includes('✕ ERROR '));
    assert.ok(out.includes('still plain'));
  });

  it('context block renders as dim `| {json}` when present', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.warn('with ctx', { a: 1 });
    const out = cap.read();
    assert.ok(out.includes(`${ANSI.dim}|${ANSI.reset} ${ANSI.dim}{"a":1}${ANSI.reset}`));
  });

  it('omits the context block when no context is supplied', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.warn('bare');
    const out = cap.read();
    assert.equal(out.includes('|'), false, `no pipe expected when context absent: ${JSON.stringify(out)}`);
  });

  it('level filtering: setLevel("warn") drops info / debug / trace, keeps warn / error', () => {
    const cap = captureStream({ isTTY: false });
    const log = new Logger({ level: 'warn', stream: cap.stream });
    log.trace('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    const out = cap.read();
    assert.equal(out.includes('TRACE'), false);
    assert.equal(out.includes('DEBUG'), false);
    assert.equal(out.includes('INFO'), false);
    assert.ok(out.includes('WARN'));
    assert.ok(out.includes('ERROR'));
  });

  it('setLevel runtime change takes effect immediately', () => {
    const cap = captureStream({ isTTY: false });
    const log = new Logger({ level: 'error', stream: cap.stream });
    log.warn('first');
    assert.equal(cap.read(), '', 'warn dropped at level=error');
    log.setLevel('warn');
    log.warn('second');
    const out = cap.read();
    assert.ok(out.includes('second'));
  });

  it('custom formatter receives the resolved IAnsi and its return goes straight to the stream', () => {
    const cap = captureStream({ isTTY: true });
    const received: { ansi: IAnsi | null } = { ansi: null };
    const log = new Logger({
      level: 'trace',
      stream: cap.stream,
      format: (record, ansi) => {
        received.ansi = ansi;
        return `CUSTOM:${record.level}:${record.message}\n`;
      },
    });
    log.warn('hello');
    assert.equal(cap.read(), 'CUSTOM:warn:hello\n');
    if (received.ansi === null) throw new Error('IAnsi must reach the custom formatter');
    // The TTY branch gives us the ENABLED ansi: paint should wrap.
    assert.equal(received.ansi.yellow('x'), `${ANSI.yellow}x${ANSI.reset}`);
  });

  it('time prefix renders as dim HH:MM:SS (matches local-time format)', () => {
    const cap = captureStream({ isTTY: true });
    const log = new Logger({ level: 'trace', stream: cap.stream });
    log.warn('time-check');
    const out = cap.read();
    // We can't pin the wall-clock string, but the structure (dim + two
    // colons + reset) is deterministic.
    const dimTimeMatch = /\x1b\[2m\d{2}:\d{2}:\d{2}\x1b\[0m/.exec(out);
    assert.ok(dimTimeMatch, `expected dim-wrapped HH:MM:SS prefix: ${JSON.stringify(out)}`);
  });
});

describe('defaultFormat (pure call, no Logger ceremony)', () => {
  // Direct calls into the exported formatter let us pin specific
  // byte-level outputs the `Logger` indirection makes awkward to
  // assert against (the time prefix moves with the wall clock).

  // Reused no-op IAnsi to make the assertions byte-stable.
  const NOOP: IAnsi = {
    green: (s) => s,
    red: (s) => s,
    yellow: (s) => s,
    cyan: (s) => s,
    dim: (s) => s,
    bold: (s) => s,
  };

  it('warn record: `<time>  ⚠ WARN   msg\\n`', () => {
    const out = defaultFormat(mkRecord({ level: 'warn', message: 'msg' }), NOOP);
    assert.equal(out, `${FIXED_TIME}  ⚠ WARN   msg\n`);
  });

  it('error record: `<time>  ✕ ERROR  msg\\n`', () => {
    const out = defaultFormat(mkRecord({ level: 'error', message: 'msg' }), NOOP);
    assert.equal(out, `${FIXED_TIME}  ✕ ERROR  msg\n`);
  });

  it('info record: `<time>  ℹ INFO   msg\\n`', () => {
    const out = defaultFormat(mkRecord({ level: 'info', message: 'msg' }), NOOP);
    assert.equal(out, `${FIXED_TIME}  ℹ INFO   msg\n`);
  });

  it('debug record: `<time>  · DEBUG  msg\\n`', () => {
    const out = defaultFormat(mkRecord({ level: 'debug', message: 'msg' }), NOOP);
    assert.equal(out, `${FIXED_TIME}  · DEBUG  msg\n`);
  });

  it('trace record: `<time>  · TRACE  msg\\n`', () => {
    const out = defaultFormat(mkRecord({ level: 'trace', message: 'msg' }), NOOP);
    assert.equal(out, `${FIXED_TIME}  · TRACE  msg\n`);
  });

  it('context payload appended after a pipe separator', () => {
    const out = defaultFormat(
      mkRecord({ level: 'warn', message: 'msg', context: { id: 7 } }),
      NOOP,
    );
    assert.equal(out, `${FIXED_TIME}  ⚠ WARN   msg | {"id":7}\n`);
  });

  it('empty context object suppresses the pipe block (Object.keys.length === 0)', () => {
    const out = defaultFormat(
      mkRecord({ level: 'warn', message: 'msg', context: {} }),
      NOOP,
    );
    assert.equal(out, `${FIXED_TIME}  ⚠ WARN   msg\n`);
  });
});

/**
 * Sink-level sanitisation. The property used to depend on every call
 * site remembering to wrap its interpolated value; two interpolating
 * sites had already been missed when it moved here. These cases are the
 * guard that it stays at the sink, so deleting the `#emit` sanitisation
 * fails loudly instead of quietly reopening the class.
 */
describe('Logger, terminal sanitisation at the sink', () => {
  const ESC = '\u001b';
  const BEL = '\u0007';

  it('strips ANSI escapes from the message without touching the paint', () => {
    const cap = captureStream({ isTTY: false });
    new Logger({ level: 'trace', stream: cap.stream, noColorFlag: true })
      .warn(`${ESC}[31mhostile${ESC}[0m`);
    const out = cap.read();
    assert.ok(!out.includes(ESC), 'no escape byte reaches the stream');
    assert.match(out, /hostile/);
    // The formatter's own decoration still renders: sanitisation runs
    // BEFORE the paint, so the logger's glyph is unaffected.
    assert.match(out, /⚠ WARN/);
  });

  it('leaves the logger own colour intact on a TTY', () => {
    const cap = captureStream({ isTTY: true });
    new Logger({ level: 'trace', stream: cap.stream }).error('plain');
    const out = cap.read();
    assert.ok(out.includes(ESC), 'the formatter still paints its own glyph');
    assert.match(out, /plain/);
  });

  it('strips bare CR and C0 controls', () => {
    const cap = captureStream({ isTTY: false });
    new Logger({ level: 'trace', stream: cap.stream, noColorFlag: true })
      .info(`before\rafter${BEL}`);
    const out = cap.read();
    assert.ok(!out.includes('\r'), 'no bare CR survives');
    assert.ok(!out.includes(BEL), 'no BEL survives');
    assert.match(out, /beforeafter/);
  });

  it('sanitises the context bag, which the formatter inlines too', () => {
    const cap = captureStream({ isTTY: false });
    new Logger({ level: 'trace', stream: cap.stream, noColorFlag: true })
      .warn('msg', { [`k${ESC}[31m`]: `v${ESC}[0m`, nested: { deep: `x${ESC}[1m` } });
    const out = cap.read();
    assert.ok(!out.includes(ESC), 'no escape byte survives via the context');
    assert.match(out, /"k":"v"/);
    assert.match(out, /"deep":"x"/);
  });

  it('preserves non-string context values verbatim', () => {
    const cap = captureStream({ isTTY: false });
    new Logger({ level: 'trace', stream: cap.stream, noColorFlag: true })
      .warn('msg', { count: 7, ok: true, missing: null, list: [1, 2] });
    assert.match(cap.read(), /\{"count":7,"ok":true,"missing":null,"list":\[1,2\]\}/);
  });

  it('caps a pathologically nested context instead of overflowing', () => {
    const cap = captureStream({ isTTY: false });
    let deep: Record<string, unknown> = { end: 'leaf' };
    for (let i = 0; i < 40; i += 1) deep = { down: deep };
    new Logger({ level: 'trace', stream: cap.stream, noColorFlag: true }).warn('msg', deep);
    assert.match(cap.read(), /depth-capped/);
  });

  it('survives a non-string message from an untyped caller', () => {
    const cap = captureStream({ isTTY: false });
    const logger = new Logger({ level: 'trace', stream: cap.stream, noColorFlag: true });
    (logger as unknown as { warn(message: unknown): void }).warn({ a: 1 });
    assert.match(cap.read(), /\[object Object\]/);
  });
});
