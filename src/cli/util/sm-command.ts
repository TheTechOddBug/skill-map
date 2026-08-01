/**
 * `SmCommand`, abstract Clipanion command base for every `sm` verb.
 *
 * Single-source the global flags from `spec/cli-contract.md` §Global flags
 * (`--json`, `-q/--quiet`, `--no-color`, `--db`) and the
 * §Elapsed time emission so individual verbs no longer declare them
 * ad-hoc, they extend `SmCommand`, implement `run()`, and inherit:
 *
 *   - Global flag declarations (Clipanion `Option.*`).
 *   - Env-var equivalents per spec § Global flags table:
 *     `SKILL_MAP_JSON=1` → `--json`, `NO_COLOR=1` → `--no-color`,
 *     `SKILL_MAP_DB=<path>` → `--db <path>`. CLI flag wins over env var
 *     (spec precedence). Note: scope is always project-local
 *     (`<cwd>/.skill-map/`); there is no `-g/--global` flag and no
 *     `SKILL_MAP_SCOPE` env var. See spec/cli-contract.md §Scope is
 *     always project-local.
 *   - `done in <…>` on stderr at the end of `execute()`, suppressed by
 *     `--quiet`. Verbs that should NOT emit elapsed (interactive
 *     spawns, long-running processes, meta verbs that report a
 *     version) opt out via `protected emitElapsed = false`.
 *
 * Subclasses implement `run()` and never override `execute()`.
 *
 * --- Naming a `--run` flag ----------------------------------------------
 *
 * A verb that wants to expose a Clipanion `--run` boolean MUST name the
 * field `runFlag` (or any other non-`run` identifier), e.g.
 * `runFlag = Option.Boolean('--run', false)`. The CLI surface stays
 * `--run`; only the TypeScript field name changes. This avoids
 * shadowing the inherited abstract `run()` method, which would silently
 * break the command at runtime (the field's getter wins over the
 * prototype method). No verb exposes `--run` today; any future one
 * follows this rule.
 */

import { Command, Option } from 'clipanion';

import { logEnabled } from '../../kernel/util/logger.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import {
  DbSchemaDriftError,
  DbVersionMismatchError,
} from '../../core/sqlite/db-version-check.js';
import { maybeOfferCrashReport } from '../telemetry/crash-consent.js';
import { UTIL_TEXTS } from '../i18n/util.texts.js';
import { ansiFor, type IAnsi } from './ansi.js';
import { DEFAULT_EXIT_CODES, ExitCode, type TExitCode } from './exit-codes.js';
import { emitDoneStderr, startElapsed, type IElapsed } from './elapsed.js';
import { createPrinter, type IPrinter } from '../../core/runtime/printer.js';

/**
 * Environment-variable presence test consistent with the spec
 * § Global flags precedence: any non-empty value counts as "set".
 * `NO_COLOR` follows the no-color.org convention (any non-empty value
 * disables color); `SKILL_MAP_JSON` / `SKILL_MAP_DB` mirror that for
 * consistency.
 */
function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

/**
 * One entry of the `globalFlags[]` catalog published by
 * `sm help --format json` (`spec/cli-contract.md` §Help). Deliberately
 * narrower than a per-verb flag entry: no `aliases`, no `required`,
 * because the JSON envelope is consumed by third parties and its shape
 * is normative. The short forms (`-q`) still travel per verb, inside
 * `verbs[].flags[].aliases`.
 */
export interface IGlobalFlag {
  name: string;
  type: 'boolean' | 'string';
  description: string;
}

/**
 * The flags EVERY verb accepts because `SmCommand` declares them.
 *
 * Hand-written on purpose, and pinned by a test: the option objects
 * themselves live in class-field initialisers on an abstract class, so
 * there is no honest way to enumerate them without instantiating a
 * concrete verb. Keeping the catalog next to the declarations (and
 * sharing one description string with each `Option.*` below) is the
 * cheapest arrangement that cannot drift silently.
 *
 * `-h` / `--help` and `--log` / `--log-level` are NOT here: neither is
 * an `Option.*` on any command class (Clipanion owns the former; the
 * latter is extracted from argv at process boot in `entry.ts`), so
 * `cli/commands/help.ts` appends both to the published catalog with
 * their own descriptions.
 */
export const GLOBAL_FLAGS: readonly IGlobalFlag[] = [
  { name: '--json', type: 'boolean', description: UTIL_TEXTS.globalFlagJson },
  { name: '--quiet', type: 'boolean', description: UTIL_TEXTS.globalFlagQuiet },
  { name: '--no-color', type: 'boolean', description: UTIL_TEXTS.globalFlagNoColor },
  { name: '--db', type: 'string', description: UTIL_TEXTS.globalFlagDb },
];

export abstract class SmCommand extends Command {
  /**
   * Every exit code this verb can return, published per verb by
   * `sm help --format json` (`spec/cli-contract.md` §Introspection,
   * NORMATIVE). Subclasses that can return more than the default
   * `[0, 2]` declare the full set with `static override exitCodes`;
   * values come from `spec/cli-contract.md` §Exit codes.
   */
  static exitCodes: readonly TExitCode[] = DEFAULT_EXIT_CODES;

  json = Option.Boolean('--json', false, {
    description: UTIL_TEXTS.globalFlagJson,
  });
  quiet = Option.Boolean('-q,--quiet', false, {
    description: UTIL_TEXTS.globalFlagQuiet,
  });
  noColor = Option.Boolean('--no-color', false, {
    description: UTIL_TEXTS.globalFlagNoColor,
  });
  db = Option.String('--db', { required: false, description: UTIL_TEXTS.globalFlagDb });

  /**
   * Subclasses set this to `false` to opt out of the trailing
   * `done in <…>` line, appropriate for interactive verbs (`db shell`),
   * watcher loops (`watch`), and meta verbs that report a fixed
   * version (`version`, `help`).
   */
  protected emitElapsed = true;

  /**
   * Wall-clock timer started just before `run()`. Subclasses that need
   * to embed `elapsedMs` in their `--json` output read `this.elapsed.ms()`.
   * `null` only between `Command` construction and the first
   * `execute()` call.
   */
  protected elapsed: IElapsed | null = null;

  /**
   * Channel-aware writer wrapping the Clipanion-injected stdout/stderr.
   * Honours `--quiet` for `info` lines so a `-q` invocation stays
   * silent on stderr advisories while still surfacing `warn` / `error`
   * (degraded state the consumer cannot infer otherwise). Subclasses
   * use `this.printer.info(...)` / `.data(...)` / `.warn(...)` /
   * `.error(...)` instead of hand-rolling `this.context.std*.write(...)`.
   * `null` only between `Command` construction and the first
   * `execute()` call (mirrors `this.elapsed`).
   */
  protected printer: IPrinter | null = null;

  protected abstract run(): Promise<number>;

  async execute(): Promise<number> {
    this.applyEnvOverrides();
    this.elapsed = startElapsed();
    this.printer = createPrinter({
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      // `--json` suppresses info banners even on stderr: users piping
      // JSON through `jq` (or asserting machine output in tests) don't
      // want decorative lines polluting either channel. Aligns CLI
      // behaviour with the printer docstring.
      quietInfo: this.quiet || this.json,
    });
    try {
      return await this.run();
    } catch (err) {
      // Global DB-open advisory boundary. A `withSqlite` open can throw
      // two typed errors carrying a pre-rendered `humanMessage`: the
      // read-side `DbVersionMismatchError` (newer / different-major DB) and
      // the write-side `DbSchemaDriftError` (drifted on-disk schema). Both
      // are operator advisories, not bugs, so render the block to stderr
      // and exit `Error` (2) instead of letting the error escape to
      // Clipanion, whose default handler dumps the class name + a stack
      // trace to stdout. This is the CLI's global command boundary: every
      // `sm` verb extends `SmCommand`, so both errors render identically
      // here regardless of which verb opened the DB.
      if (err instanceof DbSchemaDriftError || err instanceof DbVersionMismatchError) {
        const block = err.humanMessage.endsWith('\n')
          ? err.humanMessage
          : `${err.humanMessage}\n`;
        this.context.stderr.write(block);
        return ExitCode.Error;
      }
      this.renderUnhandledError(err);
      await this.offerCrashReport(err);
      return ExitCode.Error;
    } finally {
      // `run()` may opt out by setting `this.emitElapsed = false`
      // (e.g. the `--watch` alias on `sm scan` delegates into the
      // long-running watcher loop and the watcher owns its own
      // shutdown line).
      if (this.emitElapsed) emitDoneStderr(this.context.stderr, this.elapsed, this.quiet);
    }
  }

  /**
   * Everything escaping `run()` that no typed branch claimed is an
   * unhandled exception: a bug or an unclassified IO failure, never a
   * scan/check result. Without this boundary Clipanion resolves the
   * throw with exit 1 (its generic failure code), which collides with
   * the public `1 = issues found` contract, and dumps the class name +
   * stack trace instead of the §3.1b error block the spec promises
   * ("unhandled exception. Accompanied by an error message on stderr",
   * §Exit codes). Renders the block on stderr; `--log debug` keeps the
   * stack reachable for debugging. The caller returns `ExitCode.Error`.
   */
  /**
   * Per-incident crash-report consent (spec/telemetry.md §Per-incident
   * crash-report consent), offered ONLY on the unhandled branch: the typed
   * advisories are operator errors, not crashes. Emits the elapsed line
   * first (and disarms the `finally`) so the measurement excludes operator
   * think-time and the prompt is the last thing on the terminal. The flow
   * can never throw or alter the exit code.
   */
  private async offerCrashReport(err: unknown): Promise<void> {
    if (this.emitElapsed && this.elapsed !== null) {
      emitDoneStderr(this.context.stderr, this.elapsed, this.quiet);
      this.emitElapsed = false;
    }
    await maybeOfferCrashReport(err, {
      stdin: this.context.stdin,
      stderr: this.context.stderr as NodeJS.WritableStream & { isTTY?: boolean },
      json: this.json,
      quiet: this.quiet,
      noColor: this.noColor,
      verb: this.path?.join(' ') ?? '',
      level: 'error',
    });
  }

  private renderUnhandledError(err: unknown): void {
    const ansi = this.ansiFor('stderr');
    this.context.stderr.write(
      tx(UTIL_TEXTS.unhandledError, {
        glyph: ansi.red('✕'),
        message: sanitizeForTerminal(formatErrorMessage(err)),
        hint: ansi.dim(UTIL_TEXTS.unhandledErrorHint),
      }),
    );
    // Stack traces belong to whoever asked for debug output. Keyed on
    // the RESOLVED level (`--log-level debug`, `SKILL_MAP_LOG_LEVEL`, or
    // the project-local preference) now that the `-v` counter is gone:
    // `-v` is the universal `--version` alias and was never ours to take.
    if (logEnabled('debug') && err instanceof Error && err.stack !== undefined) {
      this.context.stderr.write(`${sanitizeForTerminal(err.stack)}\n`);
    }
  }

  /**
   * Promote spec env vars into flag values when the flag was left at
   * default. CLI flag wins over env var (spec § Global flags
   * precedence: "CLI flag wins over env var. Env var wins over config
   * file.").
   */
  private applyEnvOverrides(): void {
    const env = process.env;
    // `flag = flag || envSet(...)` is sound only while every flag below
    // defaults to `false`. The day a default flips to `true` (or any
    // truthy non-default), the env var would be silently ignored
    // because the OR short-circuits on the CLI default. If that day
    // comes, switch to Clipanion's `tolerateBoolean` / explicit-set
    // tracking so "user did not pass the flag" stays distinct from
    // "user passed --flag=false".
    this.noColor = this.noColor || isEnvSet(env['NO_COLOR']);
    this.json = this.json || isEnvSet(env['SKILL_MAP_JSON']);
    if (this.db === undefined && isEnvSet(env['SKILL_MAP_DB'])) {
      this.db = env['SKILL_MAP_DB'];
    }
  }

  /**
   * Resolve the ANSI helper for either output stream. Reads `--no-color`
   * from this command and the target stream's `isTTY` from the
   * Clipanion-injected context. Centralises what was previously a
   * 67-occurrence boilerplate sprinkled across every verb.
   *
   * Pass `'stdout'` for the result stream, `'stderr'` for banners /
   * advisories / errors. The two streams may have different TTY status
   * (e.g. piping stdout but keeping stderr interactive), so the channel
   * matters.
   */
  protected ansiFor(stream: 'stdout' | 'stderr'): IAnsi {
    const target = stream === 'stdout' ? this.context.stdout : this.context.stderr;
    const isTTY = (target as NodeJS.WriteStream).isTTY === true;
    return ansiFor({ isTTY, noColorFlag: this.noColor });
  }
}
