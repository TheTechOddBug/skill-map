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
}

const ENV_VAR = 'SKILL_MAP_LOG_LEVEL';
const FLAG_NAME = '--log-level';

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

  #emit(level: TLogMethodLevel, message: string, context?: Record<string, unknown>): void {
    if (logLevelRank(level) < logLevelRank(this.#level)) return;
    const record: LogRecord = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...(context !== undefined ? { context } : {}),
    };
    this.#stream.write(this.#format(record, this.#ansi));
  }
}

export interface IResolveLogLevelOptions {
  flag?: string | null;
  env?: string | null;
  fallback: TLogLevel;
  /** Where to write the warning when an invalid level is passed. Defaults to `process.stderr`. */
  errStream?: NodeJS.WritableStream;
}

/**
 * Resolve the active log level from CLI flag (highest priority), env
 * var (`SKILL_MAP_LOG_LEVEL`), then a fallback default. Invalid values
 * write a one-line warning to `errStream` and fall through to the next
 * source so a typo doesn't silently disable logging.
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

  const sources: ReadonlyArray<string | null | undefined> = [opts.flag, opts.env];
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
    if (arg === FLAG_NAME) {
      value = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith(`${FLAG_NAME}=`)) {
      value = arg.slice(FLAG_NAME.length + 1);
      continue;
    }
    rest.push(arg);
  }
  return { value, rest };
}

export const LOGGER_ENV_VAR = ENV_VAR;
