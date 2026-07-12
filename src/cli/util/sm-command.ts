/**
 * `SmCommand`, abstract Clipanion command base for every `sm` verb.
 *
 * Single-source the global flags from `spec/cli-contract.md` §Global flags
 * (`--json`, `-q/--quiet`, `--no-color`, `-v/--verbose`, `--db`) and the
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
 *   - `-v` / `-vv` / `-vvv` reconfigures the kernel logger to
 *     `info` / `debug` / `trace` respectively.
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
 * prototype method). Today this convention applies to `JobSubmitCommand`
 * (`stubs.ts`); future job verbs follow the same rule.
 */

import { Command, Option } from 'clipanion';

import { configureLogger } from '../../kernel/util/logger.js';
import type { TLogLevel } from '../../kernel/ports/logger.js';
import {
  DbSchemaDriftError,
  DbVersionMismatchError,
} from '../../core/sqlite/db-version-check.js';
import { ansiFor, type IAnsi } from './ansi.js';
import { ExitCode } from './exit-codes.js';
import { Logger } from './logger.js';
import { emitDoneStderr, startElapsed, type IElapsed } from './elapsed.js';
import { createPrinter, type IPrinter } from './printer.js';

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

export abstract class SmCommand extends Command {
  json = Option.Boolean('--json', false, {
    description: 'Emit machine-readable output on stdout. Suppresses pretty printing.',
  });
  quiet = Option.Boolean('-q,--quiet', false, {
    description: 'Suppress non-error stderr output (including "done in <…>").',
  });
  noColor = Option.Boolean('--no-color', false, {
    description: 'Disable ANSI color codes.',
  });
  verbose = Option.Counter('-v,--verbose', 0, {
    description: 'Increase log level (-v=info, -vv=debug, -vvv=trace).',
  });
  db = Option.String('--db', { required: false, description: 'Override the database file location (escape hatch).' });

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
    this.applyVerboseLogger();
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
      throw err;
    } finally {
      // `run()` may opt out by setting `this.emitElapsed = false`
      // (e.g. the `--watch` alias on `sm scan` delegates into the
      // long-running watcher loop and the watcher owns its own
      // shutdown line).
      if (this.emitElapsed) emitDoneStderr(this.context.stderr, this.elapsed, this.quiet);
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
   * `-v` / `-vv` / `-vvv` reconfigures the kernel logger. Skipped
   * when `verbose === 0` so the level configured at `entry.ts` boot
   * (from `--log-level` / `SKILL_MAP_LOG_LEVEL`) stays in effect.
   */
  private applyVerboseLogger(): void {
    if (this.verbose <= 0) return;
    const level: TLogLevel = this.verbose >= 3 ? 'trace' : this.verbose === 2 ? 'debug' : 'info';
    configureLogger(new Logger({ level, stream: this.context.stderr }));
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
