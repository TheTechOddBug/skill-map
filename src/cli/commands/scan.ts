import { Command, Option } from 'clipanion';

import { SmCommand } from '../util/sm-command.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { tx } from '../../kernel/util/tx.js';
import { SCAN_TEXTS } from '../i18n/scan.texts.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import { ExitCode } from '../util/exit-codes.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { relativeIfBelow } from '../util/path-display.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { runScanForCommand } from '../util/scan-runner.js';
import { runWatchLoop } from './watch.js';

/**
 * `sm scan [roots...] [--json] [--no-built-ins] [--no-plugins] [-n|--dry-run] [--changed]`
 *
 * Scans the given roots using the built-in extension set (claude Provider,
 * 4 extractors, 3 rules) plus any drop-in plugin extensions discovered
 * under `.skill-map/plugins/` and `~/.skill-map/plugins/` (Step 9.1).
 * The registry is populated with manifest rows so introspection
 * (`sm help`, `sm plugins list`) sees what's active; the orchestrator
 * consumes the callable instances separately.
 *
 * Result is persisted into `<cwd>/.skill-map/skill-map.db` (auto-migrated)
 * with replace-all semantics across `scan_nodes / scan_links / scan_issues`.
 *
 * - `--no-built-ins` skips both the pipeline and the persistence step
 *   (kernel-empty-boot parity); cannot be combined with `--changed`.
 * - `--no-plugins` skips drop-in plugin discovery entirely. Only the
 *   built-in set runs. Pairs with `--no-built-ins` for a fully empty
 *   pipeline (e.g. for the `kernel-empty-boot` conformance contract).
 *   Failed / incompatible plugins are logged to stderr and skipped;
 *   the scan never aborts on a bad plugin.
 * - `-n` / `--dry-run` runs the scan in-memory and skips ALL DB writes.
 *   Combined with `--changed` it still opens the DB read-side to load
 *   the prior snapshot, then exits without writing.
 * - `--changed` performs an incremental scan against the persisted prior
 *   snapshot. Reuses unchanged nodes (matched by path + bodyHash +
 *   frontmatterHash) and reprocesses new / modified files only. If the
 *   DB doesn't exist or the prior snapshot is empty, degrades to a full
 *   scan and prints a one-liner to stderr.
 */
export class ScanCommand extends SmCommand {
  static override paths = [['scan']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Scan roots for markdown nodes, run extractors and rules.',
    details: `
      Walks the given roots with the built-in claude Provider, runs the
      frontmatter / slash / at-directive / external-url-counter
      extractors per node, then the trigger-collision / broken-ref /
      superseded rules over the full graph. Emits a ScanResult
      conforming to scan-result.schema.json.

      The result is persisted into <cwd>/.skill-map/skill-map.db
      (replace-all over scan_nodes/links/issues). Pass --no-built-ins
      to skip both the pipeline and the persistence step (kernel-empty-boot
      parity).

      Pass -n / --dry-run to skip every DB operation (the result is
      computed in memory and emitted to stdout). Pass --changed to load
      the prior snapshot from the DB, reuse unchanged nodes, and only
      reprocess new / modified files.

      With -g / --global the scan walks every active Provider's
      explorationDir resolved against ~ (e.g. ~/.claude, ~/.gemini,
      ~/.agents) instead of the cwd; config + DB resolve from the
      global scope. Mutually exclusive with positional roots.

      Project-scope scans honour scan.includeHome (append HOME
      provider dirs to the cwd-rooted scan), scan.extraRoots
      (append extra dirs verbatim), and scan.referencePaths (walk
      the configured dirs for link-validation only — files there
      are not indexed). All three are privacy-sensitive; see
      "sm config set --help" for the --yes gate.
    `,
    examples: [
      ['Scan the current directory', '$0 scan'],
      ['Scan multiple roots and print JSON', '$0 scan ./docs ./skills --json'],
      ['Scan only HOME provider dirs', '$0 scan -g'],
      ['Empty-pipeline conformance', '$0 scan --no-built-ins --json'],
      ['Dry-run, no DB writes', '$0 scan -n --json'],
      ['Incremental scan against prior snapshot', '$0 scan --changed'],
      ['What would the next incremental scan persist?', '$0 scan --changed -n --json'],
    ],
  });

  roots = Option.Rest({ name: 'roots' });
  noBuiltIns = Option.Boolean('--no-built-ins', false, {
    description: 'Skip the built-in extension set. Yields a zero-filled ScanResult (kernel-empty-boot parity); skips DB persistence.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery. Only the built-in set runs. Combine with --no-built-ins for a fully empty pipeline.',
  });
  noTokens = Option.Boolean('--no-tokens', false, {
    description: 'Skip per-node token counts (cl100k_base BPE). Leaves node.tokens undefined; spec-valid since the field is optional.',
  });
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Run the scan in memory and skip every DB write. Combined with --changed, still opens the DB read-side to load the prior snapshot.',
  });
  changed = Option.Boolean('--changed', false, {
    description: 'Incremental scan: reuse unchanged nodes from the persisted prior snapshot. Degrades to a full scan if no prior snapshot exists.',
  });
  allowEmpty = Option.Boolean('--allow-empty', false, {
    description: 'Allow a zero-result scan to wipe an already-populated DB (replace-all replace by zero rows). Off by default to avoid the typo-trap where an invalid root silently clears your data.',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Promote frontmatter-validation findings from warn to error (exit code 1 on any violation). Overrides scan.strict from config when both are set.',
  });
  watch = Option.Boolean('--watch', false, {
    description: 'Long-running mode: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`.',
  });

  // Each branch in the orchestrator maps to one validation gate
  // (--watch alias / --changed mutex / -g mutex / dispatch).
  // Splitting per branch scatters the gate from the value it gates.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    if (this.watch) return this.runWatchAlias();

    // `--no-built-ins` zero-fills the pipeline; combining it with
    // `--changed` (which loads a prior to merge against) is incoherent.
    if (this.changed && this.noBuiltIns) {
      const stderr = this.context.stderr as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
      this.printer!.info(
        tx(SCAN_TEXTS.changedWithoutBuiltIns, {
          glyph: ansi.red('✕'),
          hint: ansi.dim(SCAN_TEXTS.changedWithoutBuiltInsHint),
        }),
      );
      return ExitCode.Error;
    }

    // `-g/--global` (inherited from SmCommand) — opts the verb into
    // global scope. Per spec/cli-contract.md § Scan: positional
    // roots and `-g` are mutually exclusive (`-g` derives the roots
    // from each Provider's `explorationDir`). Reject up front so the
    // user gets a directed message instead of the runner's
    // defence-in-depth error.
    //
    // `=== true` is intentional: Clipanion may leave `this.global`
    // as a non-boolean sentinel (or `undefined`) when the verb is
    // constructed manually for tests; only an explicit boolean
    // `true` should engage the guard.
    if (this.global === true && this.roots.length > 0) {
      const stderr = this.context.stderr as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
      this.printer!.info(
        tx(SCAN_TEXTS.globalWithRoots, { glyph: ansi.red('✕') }),
      );
      return ExitCode.Error;
    }

    // Empty positional roots → runner derives them from cfg + scope
    // per spec/cli-contract.md § Scan / Effective roots.
    const roots = this.roots;
    const stdout = this.context.stdout as NodeJS.WriteStream;
    const colorEnabled = (stdout.isTTY === true) && !this.noColor;
    const outcome = await runScanForCommand({
      roots,
      scope: this.global === true ? 'global' : 'project',
      noBuiltIns: this.noBuiltIns,
      noPlugins: this.noPlugins,
      noTokens: this.noTokens,
      dryRun: this.dryRun,
      changed: this.changed,
      allowEmpty: this.allowEmpty,
      strict: this.strict,
      stderr: this.context.stderr,
      printer: this.printer!,
      killSwitches: readConformanceKillSwitches(),
      colorEnabled,
    });

    return outcome.kind === 'ok'
      ? this.renderOutcome(outcome.result, outcome.persistedTo, outcome.dbPath, outcome.strict)
      : this.renderFailure(outcome);
  }

  /**
   * `--watch` is a thin alias for the `sm watch` verb. Combining
   * `--watch` with one-shot-only flags is incoherent — the watcher
   * always persists incrementally over the prior snapshot.
   */
  private async runWatchAlias(): Promise<number> {
    if (this.noBuiltIns || this.dryRun || this.changed || this.allowEmpty) {
      const stderr = this.context.stderr as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
      this.printer!.info(tx(SCAN_TEXTS.watchCannotCombine, { glyph: ansi.red('✕') }));
      return ExitCode.Error;
    }
    this.emitElapsed = false;
    const roots = this.roots.length > 0 ? this.roots : ['.'];
    return runWatchLoop({
      roots,
      json: this.json,
      noTokens: this.noTokens,
      strict: this.strict,
      noPlugins: this.noPlugins,
      context: this.context,
      printer: this.printer!,
    });
  }

  /** Render the failure branch of `IScanRunResult` to stderr. */
  private renderFailure(
    outcome: Exclude<Awaited<ReturnType<typeof runScanForCommand>>, { kind: 'ok' }>,
  ): number {
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
    const errGlyph = ansi.red('✕');
    if (outcome.kind === 'guard-trip') {
      this.printer!.info(
        tx(SCAN_TEXTS.guardWipeRefused, {
          glyph: errGlyph,
          existing: outcome.existing,
          hint: ansi.dim(SCAN_TEXTS.guardWipeRefusedHint),
        }),
      );
      return ExitCode.Error;
    }
    this.printer!.info(
      tx(SCAN_TEXTS.scanFailure, { glyph: errGlyph, message: outcome.message }),
    );
    return ExitCode.Error;
  }

  /**
   * Render the successful outcome to stdout (JSON or human) and compute
   * the exit code. Exit 1 only when at least one issue is at `error`
   * severity (mirrors `sm check`, per spec § Exit codes).
   */
  private renderOutcome(
    result: import('../../kernel/index.js').ScanResult,
    persistedTo: string | null,
    dbPath: string,
    strict: boolean,
  ): number {
    const exitCode = result.issues.some((i) => i.severity === 'error') ? ExitCode.Issues : ExitCode.Ok;

    if (this.json) {
      return this.#renderJsonOutcome(result, exitCode, strict);
    }

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const cwd = defaultRuntimeContext().cwd;
    const hasErrors = exitCode === ExitCode.Issues;
    const issuesCount = result.stats.issuesCount;

    const glyph = hasErrors
      ? ansi.red('✕')
      : ansi.green('✓');
    const counts = formatScanCounts({
      nodes: result.stats.nodesCount,
      links: result.stats.linksCount,
      issues: issuesCount,
      hasErrors,
      ansi,
    });
    const duration = ansi.dim(`in ${result.stats.durationMs}ms`);
    const rootsSuffix = result.roots.length > 1
      ? ansi.dim(`  (${result.roots.length} roots)`)
      : '';

    this.printer!.data(
      tx(SCAN_TEXTS.scannedSummary, { glyph, counts, duration, rootsSuffix }),
    );
    if (persistedTo) {
      this.printer!.data(
        tx(SCAN_TEXTS.persistedTo, {
          dbPath: ansi.dim(relativeIfBelow(persistedTo, cwd)),
        }),
      );
    } else if (this.dryRun && !this.noBuiltIns) {
      this.printer!.data(
        tx(SCAN_TEXTS.wouldPersist, {
          dbPath: ansi.dim(relativeIfBelow(dbPath, cwd)),
        }),
      );
    }
    return exitCode;
  }

  /**
   * `--json` output path. Under `--strict` (H4) self-validates the
   * ScanResult against `scan-result.schema.json` before emitting it,
   * catching drift a custom extractor could otherwise slip into stdout.
   */
  #renderJsonOutcome(
    result: import('../../kernel/index.js').ScanResult,
    exitCode: number,
    strict: boolean,
  ): number {
    if (strict) {
      const validators = loadSchemaValidators();
      const validation = validators.validate('scan-result', result);
      if (!validation.ok) {
        const stderr = this.context.stderr as NodeJS.WriteStream;
        const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
        this.printer!.info(
          tx(SCAN_TEXTS.jsonSelfValidationFailed, {
            glyph: ansi.red('✕'),
            errors: validation.errors,
          }),
        );
        return ExitCode.Error;
      }
    }
    this.printer!.data(JSON.stringify(result) + '\n');
    return exitCode;
  }
}

/**
 * Format the dot-separated `N nodes · M links · K issues` counts block.
 * The `issues` count is colored to draw the eye when it carries weight:
 * red on error-severity issues, yellow on warn-only, dim on zero. Nodes
 * and links stay plain — they're routine output, not signals.
 */
function formatScanCounts(opts: {
  nodes: number;
  links: number;
  issues: number;
  hasErrors: boolean;
  ansi: IAnsi;
}): string {
  const { nodes, links, issues, hasErrors, ansi } = opts;
  const issuesText = `${issues} ${plural(issues, 'issue')}`;
  const issuesColored = issues === 0
    ? ansi.dim(issuesText)
    : hasErrors
      ? ansi.red(issuesText)
      : ansi.yellow(issuesText);
  return `${nodes} ${plural(nodes, 'node')} · ${links} ${plural(links, 'link')} · ${issuesColored}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

