/**
 * Concrete CLI logger that implements `LoggerPort`. Configurable level,
 * stream, and format.
 *
 * Defaults: level `warn`, formatter `defaultFormat`, stream is supplied
 * by the caller (almost always `process.stderr`, logging is a side
 * channel, stdout stays clean for data output like JSON / table rows).
 *
 * Wiring: `entry.ts` pre-parses `--log-level` (CLI flag) and
 * `SKILL_MAP_LOG_LEVEL` (env var) via `extractLogLevelFlag` +
 * `resolveLogLevel`, instantiates `Logger`, and installs it as the
 * kernel singleton via `configureLogger(...)`. Anywhere in the codebase
 * that needs to log: `import { log } from '<.../>kernel/util/logger.js'`.
 */

import type {
  TLogLevel,
  TLogMethodLevel,
  LogRecord,
  LoggerPort,
} from '../../kernel/ports/logger.js';
import { LOG_LEVELS, logLevelRank, parseLogLevel } from '../../kernel/ports/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { LOGGER_TEXTS } from '../i18n/logger.texts.js';
import { ansiFor, type IAnsi } from './ansi.js';

/** Formatter signature, the second argument is the resolved ANSI
 *  helper for the configured stream. The default formatter uses it
 *  to paint the per-level glyph + label; custom formatters may
 *  ignore it (a no-op `IAnsi` is always supplied so destructuring
 *  is safe). */
export type TLogFormatter = (record: LogRecord, ansi: IAnsi) => string;

export interface ILoggerOptions {
  level: TLogLevel;
  stream: NodeJS.WritableStream;
  format?: TLogFormatter;
  /**
   * Mirrors the rest of the CLI's color resolution (`--no-color` flag).
   * Combined with the stream's `isTTY` flag inside the constructor
   * to pick the right `IAnsi` once per logger instance. Default
   * `false` (resolution falls through to TTY + env vars).
   */
  noColorFlag?: boolean;
  /**
   * Override the env source used to resolve `NO_COLOR` / `FORCE_COLOR`.
   * Defaults to `process.env`. Tests inject `{}` to isolate from the
   * outer shell so a `FORCE_COLOR=1` developer terminal does not flip
   * a non-TTY assertion.
   */
  env?: NodeJS.ProcessEnv;
}

const ENV_VAR = 'SKILL_MAP_LOG_LEVEL';
/**
 * Accepted spellings of the log-level flag, longest first so
 * `--log-level=x` is never mis-sliced by the `--log=` prefix test.
 * `--log` is the short form; both take the same values.
 */
const FLAG_NAMES = ['--log-level', '--log'] as const;

/**
 * Default human-readable format: `HH:MM:SS  <glyph> LEVEL  message
 * [| {context}]`. Local time, no date, CLI sessions are short-lived
 * and the date is implicit. The glyph + level label are painted per
 * level via the supplied `IAnsi` helper, matching the rest of the
 * CLI's output style (see `context/cli-output-style.md`):
 *
 *   - `error` → red `✕ ERROR`
 *   - `warn`  → yellow `⚠ WARN`
 *   - `info`  → cyan `ℹ INFO`
 *   - `debug` / `trace` → dim, no glyph (developer-mode noise stays
 *     visually quiet so the eye picks out the louder lines first)
 *
 * Use a custom formatter via `new Logger({ format: ... })` if you
 * need ISO timestamps or JSON lines.
 *
 * `record.timestamp` is the ISO 8601 string captured at log time; we
 * re-derive local HH:MM:SS from it so the formatter is pure (no extra
 * `new Date()` call) and a custom record passed to the formatter
 * renders consistently.
 */
function localTimeFromIso(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Per-level glyph + paint helper. Splits the prefix from the rest of
 *  the message so each level keeps its own colour without leaking the
 *  escape across the context block. */
function paintLevelPrefix(level: TLogMethodLevel, ansi: IAnsi): string {
  const label = level.toUpperCase().padEnd(5);
  switch (level) {
    case 'error':
      return `${ansi.red('✕')} ${ansi.red(label)}`;
    case 'warn':
      return `${ansi.yellow('⚠')} ${ansi.yellow(label)}`;
    case 'info':
      return `${ansi.cyan('ℹ')} ${ansi.cyan(label)}`;
    case 'debug':
    case 'trace':
      return `${ansi.dim('·')} ${ansi.dim(label)}`;
  }
}

export const defaultFormat: TLogFormatter = (record, ansi) => {
  const time = localTimeFromIso(record.timestamp);
  const prefix = paintLevelPrefix(record.level, ansi);
  const ctx =
    record.context && Object.keys(record.context).length > 0
      ? ` ${ansi.dim('|')} ${ansi.dim(JSON.stringify(record.context))}`
      : '';
  return `${ansi.dim(time)}  ${prefix}  ${record.message}${ctx}\n`;
};

export class Logger implements LoggerPort {
  #level: TLogLevel;
  readonly #stream: NodeJS.WritableStream;
  readonly #format: TLogFormatter;
  readonly #ansi: IAnsi;

  constructor(opts: ILoggerOptions) {
    this.#level = opts.level;
    this.#stream = opts.stream;
    this.#format = opts.format ?? defaultFormat;
    // Resolve the paint helper once per instance. `isTTY` is read from
    // the configured stream when present (process.stderr / a TTY mock),
    // falls back to `false` for in-memory buffers (tests, captured
    // output). Env vars (`NO_COLOR` / `FORCE_COLOR`) are honoured by
    // `ansiFor` per the project-wide precedence.
    const streamTty = opts.stream as NodeJS.WritableStream & { isTTY?: boolean };
    this.#ansi = ansiFor({
      isTTY: streamTty.isTTY === true,
      noColorFlag: opts.noColorFlag === true,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    });
  }

  setLevel(level: TLogLevel): void {
    this.#level = level;
  }

  level(): TLogLevel {
    return this.#level;
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.#emit('trace', message, context);
  }
  debug(message: string, context?: Record<string, unknown>): void {
    this.#emit('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.#emit('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.#emit('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.#emit('error', message, context);
  }

  /**
   * Sanitise at the SINK, not at each call site.
   *
   * Log messages routinely interpolate values the operator does not
   * control: an error message naming a file, a plugin-authored id, a
   * provider hook label, a remote response fragment. Written verbatim,
   * any of those carries ANSI escapes and C0 controls straight to the
   * terminal. Eleven call sites had grown their own
   * `sanitizeForTerminal(...)` wrapper for exactly this, which left the
   * property depending on every future author remembering, and two
   * interpolating sites had already been missed.
   *
   * Doing it here closes the class by construction and costs ~136 ns on
   * a typical line (measured; ~7M lines/s), which is nothing against a
   * stream write. Ordering matters and works out: the formatter paints
   * its glyph and timestamp AFTER this, so the logger's own colour
   * survives while extension- and error-sourced text cannot smuggle any
   * in. No call site pre-colours its message, which was verified before
   * moving the responsibility here.
   *
   * The `context` bag is walked too: `defaultFormat` JSON-stringifies it
   * into the same line, so an unsanitised value there reaches the
   * terminal by the same path the message would.
   */
  #emit(level: TLogMethodLevel, message: string, context?: Record<string, unknown>): void {
    if (logLevelRank(level) < logLevelRank(this.#level)) return;
    const clean = context === undefined ? undefined : sanitizeContext(context);
    const record: LogRecord = {
      level,
      timestamp: new Date().toISOString(),
      // `String(...)` first: an untyped JS caller (a plugin reaching the
      // singleton, a JSON payload field) can pass a non-string, and a
      // throw inside the logger would take down the operation it was
      // only reporting on.
      message: sanitizeForTerminal(String(message)),
      ...(clean !== undefined ? { context: clean } : {}),
    };
    this.#stream.write(this.#format(record, this.#ansi));
  }
}

/**
 * Depth cap for the context walk. Log context bags are flat by
 * convention; the cap exists so a cyclic or pathologically nested value
 * cannot turn a log line into a stack overflow. Anything deeper is
 * replaced by a marker rather than dropped silently, so a reader can
 * tell truncation from absence.
 */
const CONTEXT_MAX_DEPTH = 6;

/** See {@link Logger.#emit}. Returns a sanitised copy; never mutates. */
function sanitizeContext(
  context: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[sanitizeForTerminal(key)] = sanitizeValue(value, depth + 1);
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > CONTEXT_MAX_DEPTH) return '[depth-capped]';
  if (typeof value === 'string') return sanitizeForTerminal(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return sanitizeContext(value as Record<string, unknown>, depth);
  }
  return value;
}

export interface IResolveLogLevelOptions {
  flag?: string | null;
  env?: string | null;
  /**
   * `logLevel` from `~/.skill-map/settings.json`, the per-machine
   * preference. Lowest priority above the fallback: a per-invocation
   * flag or env var always wins, so the standing preference never
   * fights a one-off.
   *
   * It lives in the user-settings file rather than project config for
   * two reasons. It is a preference of the HUMAN, not of the repo (an
   * operator who wants verbose output wants it everywhere), and a
   * committed one would push one person's debugging onto the whole
   * team. And the level is resolved at process boot, before any project
   * config exists: reading it here costs one file read, while the
   * project layers would need the whole loader running on every
   * invocation, including those outside a project.
   */
  userSetting?: string | null;
  fallback: TLogLevel;
  /** Where to write the warning when an invalid level is passed. Defaults to `process.stderr`. */
  errStream?: NodeJS.WritableStream;
}

/**
 * Resolve the active log level from CLI flag (highest priority), env
 * var (`SKILL_MAP_LOG_LEVEL`), the `~/.skill-map/settings.json`
 * preference, then a fallback default. Invalid values write a one-line
 * warning to `errStream` and fall through to the next source so a typo
 * doesn't silently disable logging.
 */
export function resolveLogLevel(opts: IResolveLogLevelOptions): TLogLevel {
  const allowed = LOG_LEVELS.join(', ');
  const errStream = opts.errStream ?? process.stderr;
  // Resolve colour through the same precedence the rest of the CLI uses
  // so a `--no-color` invocation strips ANSI from the glyph + hint.
  // `errStream` may be a non-TTY (`Logger` defaults to process.stderr in
  // most code paths but tests sometimes inject a buffer); the helper
  // tolerates a missing `isTTY` by treating it as `false`.
  const errStreamTty = errStream as NodeJS.WriteStream & { isTTY?: boolean };
  const ansi = ansiFor({ isTTY: errStreamTty.isTTY === true, noColorFlag: false });

  const sources: ReadonlyArray<string | null | undefined> = [opts.flag, opts.env, opts.userSetting];
  for (const raw of sources) {
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = parseLogLevel(raw);
    if (parsed) return parsed;
    // `raw` is user-controlled (CLI flag value or env var). A hostile
    // env (e.g. shared dotfile, CI variable) could ship ANSI escapes
    // through this warning; sanitize before printing.
    errStream.write(
      tx(LOGGER_TEXTS.invalidLevel, {
        glyph: ansi.yellow('⚠'),
        value: sanitizeForTerminal(raw),
        hint: ansi.dim(tx(LOGGER_TEXTS.invalidLevelHint, { allowed })),
      }),
    );
  }
  return opts.fallback;
}

/**
 * Extract `--log-level` from an argv array without mutating the input.
 * Supports `--log-level=value` and `--log-level value` forms. Returns
 * the extracted value (or null) and the remaining argv with the flag
 * removed so Clipanion never sees it (it isn't a Clipanion option).
 *
 * Edge case: bare `--log-level` at end of argv yields `value: null`,
 * which `resolveLogLevel` treats as "no source supplied" and moves on.
 */
export function extractLogLevelFlag(argv: readonly string[]): {
  value: string | null;
  rest: string[];
} {
  const rest: string[] = [];
  let value: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const spaced = FLAG_NAMES.find((name) => arg === name);
    if (spaced !== undefined) {
      value = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    const inlined = FLAG_NAMES.find((name) => arg.startsWith(`${name}=`));
    if (inlined !== undefined) {
      value = arg.slice(inlined.length + 1);
      continue;
    }
    rest.push(arg);
  }
  return { value, rest };
}

export const LOGGER_ENV_VAR = ENV_VAR;
