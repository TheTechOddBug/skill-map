/**
 * `sm conformance run [--scope spec|provider:<id>|all]`, kernel-side CLI
 * verb for the conformance suite (Phase 5 / A.13).
 *
 * The verb is a thin orchestration layer over `runConformanceCase` (in
 * `src/conformance/index.ts`) and the scope registry at
 * `cli/util/conformance-scopes.ts`. It:
 *
 *   1. Resolves the requested scope set (`spec`, `provider:<id>`, or
 *      `all`, default).
 *   2. For each scope, enumerates `cases/*.json` and runs them one by
 *      one against the same `sm` binary that hosts the verb.
 *   3. Prints a pass/fail line per case + a summary per scope + a
 *      grand total.
 *
 * Why dispatch to a child `sm` instead of calling the orchestrator
 * directly: the runner already exec's `bin/sm.js` for assertion
 * symmetry, it is the contract every conforming impl must satisfy.
 * Reusing it keeps `sm conformance run` honest (the verb passes the
 * same gate any third-party reviewer would run).
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  every case in every selected scope passed
 *   1  one or more cases failed
 *   2  configuration error (unknown `--scope`, missing binary, ...)
 *
 * Stub caveats, the surface beyond the dispatch loop is intentionally
 * thin in this bump:
 *
 *   - No parallelism. Cases run sequentially per scope; the runner
 *     already provisions an isolated tmp directory per case so this is
 *     a perf knob, not a correctness one.
 *   - The `file-matches-schema` assertion is still stubbed in the
 *     runner itself (lands with Step 2's AJV wiring). Cases relying on
 *     it report `not yet implemented` per case, not per verb.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'clipanion';

import { runConformanceCase } from '../../conformance/index.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { CONFORMANCE_TEXTS } from '../i18n/conformance.texts.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { SmCommand } from '../util/sm-command.js';
import { truncateHead } from '../util/text.js';
import {
  listCaseFiles,
  selectConformanceScopes,
  type IConformanceScope,
} from '../util/conformance-scopes.js';

// Cap for assertion `reason` strings before they reach stderr. The
// runner can splice subprocess `stderr` content (`stepChild.stderr`) into
// the reason payload, which is unbounded, a runaway impl could emit
// kilobytes that drown the user's terminal. Mirrors the cap policy used
// for plugin-warning interpolation in `cli/util/plugin-runtime.ts`.
const ASSERTION_REASON_DISPLAY_CAP = 1000;

/**
 * `--json` envelope per `spec/schemas/conformance-result.schema.json`.
 * Emitted on the data channel when `--json` is set; the human
 * per-case + scope-summary + grand-total lines are suppressed in that
 * mode (the same data is folded into the envelope).
 */
interface IConformanceJsonEnvelope {
  ok: true;
  kind: 'conformance.result';
  totals: { scopes: number; cases: number; passCount: number; failCount: number };
  scopes: Array<{
    label: string;
    passCount: number;
    caseCount: number;
    cases: Array<{
      id: string;
      status: 'pass' | 'fail';
      failures: Array<{ type: string; reason: string }>;
    }>;
  }>;
  elapsedMs: number;
}

/** Error code catalog for `--json` failures (mirrors `cli-contract.md` §Error envelope). */
type TConformanceJsonErrorCode = 'bad-query' | 'internal';

/**
 * Render one failed-assertion line for stderr. The `reason` flows from
 * the conformance runner, some assertion variants splice the
 * impl-under-test's stderr verbatim into it (`runtime-error` carries
 * subprocess output as-is), sanitize + cap before emitting so a
 * hostile or buggy impl cannot smuggle ANSI escapes into the user's
 * terminal via its own failure output.
 *
 * Exported for the audit M1 unit tests in
 * `test/conformance-cli.test.ts`, production callers reach this
 * through `ConformanceRunCommand.execute`.
 */
export function formatAssertionFailureDetail(
  type: string,
  reason: string,
): string {
  return tx(CONFORMANCE_TEXTS.caseFailureDetail, {
    type,
    reason: sanitizeForTerminal(
      truncateHead(reason, ASSERTION_REASON_DISPLAY_CAP),
    ),
  });
}

/**
 * Resolve the absolute path to `bin/sm.js` relative to this module's
 * location. Works in both the source-tree layout
 * (`src/cli/commands/conformance.ts` → `src/bin/sm.js`) and the bundled
 * dist layout (`dist/cli.js` → `dist/../bin/sm.js`). The dev flow runs
 * `tsx` directly so module identity is fine; the build flow re-exports
 * via `dist/cli.js`, also next to `bin/`.
 */
function resolveBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // walk up looking for a sibling `bin/sm.js`
  let cursor = here;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(cursor, 'bin', 'sm.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolve(here, '..', '..', 'bin', 'sm.js');
}

export class ConformanceRunCommand extends SmCommand {
  static override paths = [['conformance', 'run']];

  static override usage = Command.Usage({
    category: 'Introspection',
    description:
      'Run the conformance suite: spec-owned cases plus every built-in Provider.',
    details: `
      Drives the conformance runner shipped at
      \`@skill-map/cli/conformance\` against the cases bundled with
      this CLI install. Each case provisions an isolated tmp scope,
      seeds the appropriate fixture, runs an \`sm\` invocation, and
      asserts the requested predicates.

      Scope selection:

        --scope spec               only spec-owned, kernel-agnostic cases
                                    (default fixture: \`preamble-v2.txt\`,
                                    case: \`kernel-empty-boot\`).
        --scope provider:<id>      only the named built-in Provider's
                                    cases. Today: \`provider:claude\`
                                    (\`basic-scan\`, \`rename-high\`,
                                    \`orphan-detection\`).
        --scope all (default)      every scope, in registry order.

      Exit codes mirror the rest of the verb catalog: 0 on a clean
      sweep, 1 if any case failed, 2 on a configuration error
      (unknown scope, missing binary).
    `,
    examples: [
      ['Run every conformance suite', '$0 conformance run'],
      ['Run only the spec suite', '$0 conformance run --scope spec'],
      [
        'Run only the Claude Provider suite',
        '$0 conformance run --scope provider:claude',
      ],
    ],
  });

  scope = Option.String('--scope', {
    required: false,
    description:
      "Suite selector: 'all' (default), 'spec', or 'provider:<id>'.",
  });

  // CLI orchestrator: scope resolution + per-case run loop +
  // per-result render branches + global pass/fail decision.
  // eslint-disable-next-line complexity
  protected async run(): Promise<TExitCode> {
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    let scopes: IConformanceScope[];
    try {
      scopes = selectConformanceScopes(this.scope);
    } catch (err) {
      const message = formatErrorMessage(err);
      if (this.json) {
        this.#emitJsonError('bad-query', message);
        return ExitCode.Error;
      }
      this.printer!.error(tx(CONFORMANCE_TEXTS.unknownScope, { glyph: errGlyph, message }));
      return ExitCode.Error;
    }

    const binary = resolveBinary();
    if (!existsSync(binary)) {
      if (this.json) {
        this.#emitJsonError(
          'internal',
          `cannot locate the sm binary at ${binary}`,
        );
        return ExitCode.Error;
      }
      this.printer!.error(
        tx(CONFORMANCE_TEXTS.noBinary, {
          glyph: errGlyph,
          binary,
          hint: stderrAnsi.dim(CONFORMANCE_TEXTS.noBinaryHint),
        }),
      );
      return ExitCode.Error;
    }

    let totalPass = 0;
    let totalCases = 0;
    let anyFailure = false;
    const scopeReports: IConformanceJsonEnvelope['scopes'] = [];

    for (const scope of scopes) {
      const cases = listCaseFiles(scope);
      if (cases.length === 0) {
        if (!this.json) {
          // Per cli-output-style.md §8: per-scope progress (header,
          // empty advisory, summary, per-case rows) routes through
          // `printer.info` (stderr, suppressed by `--quiet`) so stdout
          // carries only the grand-total result.
          this.printer!.info(
            tx(CONFORMANCE_TEXTS.scopeEmpty, { label: scope.label }),
          );
        }
        scopeReports.push({ label: scope.label, passCount: 0, caseCount: 0, cases: [] });
        continue;
      }
      if (!this.json) {
        this.printer!.info(
          tx(CONFORMANCE_TEXTS.scopeHeader, {
            label: scope.label,
            caseCount: cases.length,
          }),
        );
      }

      let scopePass = 0;
      const caseReports: IConformanceJsonEnvelope['scopes'][number]['cases'] = [];
      for (const casePath of cases) {
        const caseId = readCaseId(casePath);
        try {
          const result = runConformanceCase({
            binary,
            specRoot: scope.specRoot,
            casePath,
            fixturesRoot: scope.fixturesDir,
          });
          if (result.passed) {
            if (!this.json) {
              this.printer!.info(
                tx(CONFORMANCE_TEXTS.caseOk, { caseId: result.caseId }),
              );
            }
            caseReports.push({ id: result.caseId, status: 'pass', failures: [] });
            scopePass += 1;
          } else {
            anyFailure = true;
            const failures = projectAssertionFailures(result.assertions);
            if (!this.json) {
              this.printer!.info(
                tx(CONFORMANCE_TEXTS.caseFail, { caseId: result.caseId }),
              );
              for (const a of result.assertions) {
                if (a.ok) continue;
                // `a.reason` flows from the conformance runner. Some
                // assertion variants splice the impl-under-test's stderr
                // into the reason payload (`runtime-error` carries
                // subprocess output verbatim), sanitize + cap before
                // emitting so a hostile or buggy impl cannot smuggle
                // ANSI escapes into the user's terminal via its own
                // failure output.
                this.printer!.info(
                  formatAssertionFailureDetail(a.type, a.reason),
                );
              }
              writeStreamSnippet(
                this.context.stderr,
                CONFORMANCE_TEXTS.caseFailureStdoutHeader,
                result.stdout,
              );
              writeStreamSnippet(
                this.context.stderr,
                CONFORMANCE_TEXTS.caseFailureStderrHeader,
                result.stderr,
              );
            }
            caseReports.push({ id: result.caseId, status: 'fail', failures });
          }
        } catch (err) {
          anyFailure = true;
          const message = formatErrorMessage(err);
          if (!this.json) {
            this.printer!.error(
              tx(CONFORMANCE_TEXTS.runtimeError, { glyph: errGlyph, message }),
            );
            this.printer!.info(tx(CONFORMANCE_TEXTS.caseFail, { caseId }));
          }
          caseReports.push({
            id: caseId,
            status: 'fail',
            failures: [{
              type: 'runtime-error',
              reason: sanitizeForTerminal(truncateHead(message, ASSERTION_REASON_DISPLAY_CAP)),
            }],
          });
        }
      }

      if (!this.json) {
        this.printer!.info(
          tx(CONFORMANCE_TEXTS.scopeSummary, {
            label: scope.label,
            passCount: scopePass,
            caseCount: cases.length,
          }),
        );
      }
      scopeReports.push({
        label: scope.label,
        passCount: scopePass,
        caseCount: cases.length,
        cases: caseReports,
      });
      totalPass += scopePass;
      totalCases += cases.length;
    }

    if (this.json) {
      const envelope: IConformanceJsonEnvelope = {
        ok: true,
        kind: 'conformance.result',
        totals: {
          scopes: scopes.length,
          cases: totalCases,
          passCount: totalPass,
          failCount: totalCases - totalPass,
        },
        scopes: scopeReports,
        elapsedMs: this.elapsed!.ms(),
      };
      this.printer!.data(JSON.stringify(envelope) + '\n');
      return anyFailure ? ExitCode.Issues : ExitCode.Ok;
    }

    this.printer!.data(
      tx(CONFORMANCE_TEXTS.totalSummary, {
        passCount: totalPass,
        caseCount: totalCases,
        scopeCount: scopes.length,
      }),
    );

    if (anyFailure) return ExitCode.Issues;
    return ExitCode.Ok;
  }

  /**
   * Emit the canonical `--json` error envelope on stdout. Mirrors the
   * shape from `cli-contract.md` §Error envelope. Suppresses the
   * human-facing glyph + hint output that the non-JSON branches still
   * render.
   */
  #emitJsonError(code: TConformanceJsonErrorCode, message: string): void {
    const payload = { ok: false as const, error: { code, message } };
    this.printer!.data(JSON.stringify(payload) + '\n');
  }
}

/**
 * Project the runner's assertion results into the wire shape declared
 * by `spec/schemas/conformance-result.schema.json`. Failures only;
 * passed assertions never land on the envelope (the case's `status`
 * already carries the verdict). Each `reason` is sanitised + capped so
 * the JSON envelope cannot smuggle ANSI bytes from a hostile impl.
 */
function projectAssertionFailures(
  assertions: ReadonlyArray<{ ok: boolean; type: string; reason?: string }>,
): Array<{ type: string; reason: string }> {
  const out: Array<{ type: string; reason: string }> = [];
  for (const a of assertions) {
    if (a.ok) continue;
    out.push({
      type: a.type,
      reason: sanitizeForTerminal(
        truncateHead(a.reason ?? '', ASSERTION_REASON_DISPLAY_CAP),
      ),
    });
  }
  return out;
}

function readCaseId(casePath: string): string {
  try {
    const raw = readFileSync(casePath, 'utf8');
    const parsed = JSON.parse(raw) as { id?: unknown };
    if (typeof parsed.id === 'string') return parsed.id;
  } catch {
    /* fall through */
  }
  return casePath;
}

function writeStreamSnippet(
  stream: { write: (s: string) => boolean | unknown },
  header: string,
  text: string,
): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  stream.write(header);
  for (const line of trimmed.split(/\r?\n/)) {
    stream.write(tx(CONFORMANCE_TEXTS.caseFailureStreamLine, { line: sanitizeForTerminal(line) }));
  }
}

export const CONFORMANCE_COMMANDS = [ConformanceRunCommand];
