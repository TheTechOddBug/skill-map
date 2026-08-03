import { Command, Option } from 'clipanion';

import { SmCommand } from '../util/sm-command.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { formatOversizedFileRows } from '../../kernel/util/format-oversized.js';
import { tx } from '../../kernel/util/tx.js';
import { SCAN_RUNNER_TEXTS } from '../../core/runtime/i18n/scan-runner.texts.js';
import { SCAN_TEXTS } from '../i18n/scan.texts.js';
import type { ScanResult } from '../../kernel/index.js';
import type { IAnsi } from '../util/ansi.js';
import { ExitCode } from '../util/exit-codes.js';
import { tryParsePositiveInt } from '../util/option-validators.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { relativeIfBelow } from '../util/path-display.js';
import { renderScanSummaryLines } from '../util/scan-summary.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { appendOperation } from '../../core/operations-log.js';
import { runScanForCommand } from '../../core/runtime/scan-runner.js';
import { addInvocationExtensions, setInvocationLens } from '../telemetry/posthog-init.js';
import { parseWatchBackend, runWatchLoop } from './watch.js';

/**
 * `sm scan [roots...] [--json] [--no-built-ins] [--no-plugins] [-n|--dry-run] [--changed]`
 *
 * Scans the given roots under the active provider lens (spec
 * `cli-contract.md` §Active provider lens) with the built-in extension
 * set plus any drop-in plugin extensions discovered under
 * `<cwd>/.skill-map/plugins/` (Step 9.1).
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
  static override exitCodes = [ExitCode.Ok, ExitCode.Issues, ExitCode.Error];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Scan roots for markdown nodes, run extractors and analyzers.',
    details: `
      Walks the given roots under the active provider lens, runs the
      enabled extractors per node, then the analyzer set over the full
      graph. Emits a ScanResult conforming to scan-result.schema.json.
      Run "sm plugins list" to see the extensions active in this
      project.

      The result is persisted into <cwd>/.skill-map/skill-map.db
      (replace-all over scan_nodes/links/issues). Pass --no-built-ins
      to skip both the pipeline and the persistence step (kernel-empty-boot
      parity).

      Pass -n / --dry-run to skip every DB operation (the result is
      computed in memory and emitted to stdout). Pass --changed to load
      the prior snapshot from the DB, reuse unchanged nodes, and only
      reprocess new / modified files.

      Scans honour scan.referencePaths (walk the configured dirs for
      link-validation only; files there are not indexed). The key is
      privacy-sensitive; see "sm config set --help" for the --yes
      gate. To extend the indexed scan beyond cwd, pass extra roots
      positionally.
    `,
    examples: [
      ['Scan the current directory', '$0 scan'],
      ['Scan multiple roots and print JSON', '$0 scan ./docs ./skills --json'],
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
  yes = Option.Boolean('--yes', false, {
    description: 'Non-interactive mode. For ambiguous activeProvider auto-detect, multiple provider markers (.claude/, .codex/, AGENTS.md, .cursor/) under the scan tree exit non-zero instead of prompting; set the lens manually via `sm config set activeProvider <id>` and re-run. Also auto-confirms the pre-1.0 schema-drift rebuild (when the DB was written by a different skill-map major.minor it is deleted and regenerated) instead of prompting.',
  });
  maxScan = Option.String('--max-scan', {
    required: false,
    description: 'Per-invocation override of `scan.maxScan` (default 5000). The WALK-INTAKE ceiling: the scan walks, parses, analyzes, and reference-validates the full corpus up to this number. Bidirectional: raises OR lowers the ceiling. When the walker hits it, additional files are dropped in stable order and the scan is marked truncated in scan_meta (the UI raises a persistent banner pointing at the .skillmapignore editor in Settings → Project). Validation: integer >= 1.',
  });
  maxNodes = Option.String('--max-nodes', {
    required: false,
    description: 'Per-invocation override of `scan.maxNodes` (default 256). The MAP RENDER cap (pure metadata): it does NOT bound the scan, only how many nodes the graph view projects onto the canvas. Bidirectional: raises OR lowers the render cap. Validation: integer >= 1.',
  });
  watchBackend = Option.String('--watch-backend', {
    required: false,
    description: 'Only with --watch: per-invocation override of scan.watch.backend, the primary watcher backend (chokidar or parcel). Ignored on a non-watching scan.',
  });

  // Each branch below maps to one validation gate (--watch alias /
  // --changed mutex / dispatch); splitting per branch would scatter
  // the gate from the value it gates.
  protected async run(): Promise<number> {
    const caps = this.parseCapFlags();
    if (caps.kind === 'error') return caps.exit;

    if (this.watch) return this.runWatchAlias();

    // `--no-built-ins` zero-fills the pipeline; combining it with
    // `--changed` (which loads a prior to merge against) is incoherent.
    if (this.changed && this.noBuiltIns) {
      const ansi = this.ansiFor('stderr');
      this.printer!.error(
        tx(SCAN_TEXTS.changedWithoutBuiltIns, {
          glyph: ansi.red('✕'),
          hint: ansi.dim(SCAN_TEXTS.changedWithoutBuiltInsHint),
        }),
      );
      return ExitCode.Error;
    }

    // Empty positional roots → runner derives them from cfg per
    // spec/cli-contract.md § Scan / Effective roots.
    const roots = this.roots;
    const stdout = this.context.stdout as NodeJS.WriteStream;
    const colorEnabled = (stdout.isTTY === true) && !this.noColor;
    // Pre-render the prompt + error block glyphs for the active-provider
    // bootstrap. Resolving here keeps `core/runtime/` colour-free (per
    // the boundary lint that forbids `process.env` reads outside the
    // CLI seam).
    const stderrAnsi = this.ansiFor('stderr');
    const style = {
      warnGlyph: stderrAnsi.yellow('⚠'),
      errorGlyph: stderrAnsi.red('✕'),
      dim: stderrAnsi.dim,
    };
    const outcome = await runScanForCommand({
      settingsEnv: process.env,
      roots,
      noBuiltIns: this.noBuiltIns,
      noPlugins: this.noPlugins,
      noTokens: this.noTokens,
      dryRun: this.dryRun,
      changed: this.changed,
      allowEmpty: this.allowEmpty,
      strict: this.strict,
      stderr: this.context.stderr,
      stdin: this.context.stdin,
      printer: this.printer!,
      killSwitches: readConformanceKillSwitches(),
      colorEnabled,
      yes: this.yes,
      style,
      ...capOverrides(caps),
    });

    if (outcome.kind === 'ok') {
      stashScanUsage(outcome.executedExtensionIds, outcome.lensAutoDetected);
      if (!this.dryRun) {
        appendOperation(defaultRuntimeContext().cwd, {
          op: 'scan',
          target: '*',
          channel: 'cli',
          outcome: 'ok',
          detail: `nodes=${outcome.result.stats.nodesCount} issues=${outcome.result.stats.issuesCount}`,
        });
      }
      return this.renderOutcome(
        outcome.result,
        outcome.persistedTo,
        outcome.dbPath,
        outcome.strict,
        outcome.lensAutoDetected,
      );
    }
    return this.renderFailure(outcome);
  }

  /**
   * Parse both cap flags in one pass: `--max-scan <N>` (the WALK-INTAKE
   * ceiling) and `--max-nodes <N>` (the MAP RENDER cap). Returns both
   * resolved values (each `undefined` when its flag was omitted) or an
   * error sentinel after printing the §3.1b validation block for the
   * first offending flag. Invalid (non-integer, < 1) exits 2 per
   * spec/cli-contract.md §Scan.
   */
  private parseCapFlags():
    | { kind: 'ok'; maxScan: number | undefined; maxNodes: number | undefined }
    | { kind: 'error'; exit: number } {
    const scan = this.parseIntegerFlag(this.maxScan, SCAN_TEXTS.maxScanInvalid, SCAN_TEXTS.maxScanInvalidHint);
    if (scan.kind === 'error') return scan;
    const nodes = this.parseIntegerFlag(this.maxNodes, SCAN_TEXTS.maxNodesInvalid, SCAN_TEXTS.maxNodesInvalidHint);
    if (nodes.kind === 'error') return nodes;
    return { kind: 'ok', maxScan: scan.value, maxNodes: nodes.value };
  }

  /**
   * Shared integer-flag parser for `--max-scan` / `--max-nodes`. Both
   * accept the same shape (integer >= 1) and render the same §3.1b
   * validation block; only the template + hint differ.
   */
  private parseIntegerFlag(
    raw: string | undefined,
    invalidTemplate: string,
    invalidHint: string,
  ): { kind: 'ok'; value: number | undefined } | { kind: 'error'; exit: number } {
    if (raw === undefined) return { kind: 'ok', value: undefined };
    const n = tryParsePositiveInt(raw);
    if (n === null) {
      const ansi = this.ansiFor('stderr');
      this.printer!.error(
        tx(invalidTemplate, {
          glyph: ansi.red('✕'),
          value: raw,
          hint: ansi.dim(invalidHint),
        }),
      );
      return { kind: 'error', exit: ExitCode.Error };
    }
    return { kind: 'ok', value: n };
  }

  /**
   * `--watch` is a thin alias for the `sm watch` verb. Combining
   * `--watch` with one-shot-only flags is incoherent, the watcher
   * always persists incrementally over the prior snapshot.
   */
  private async runWatchAlias(): Promise<number> {
    const conflict = this.#firstWatchConflict();
    if (conflict !== null) {
      const ansi = this.ansiFor('stderr');
      this.printer!.error(
        tx(conflict.template, {
          glyph: ansi.red('✕'),
          hint: ansi.dim(conflict.hint),
        }),
      );
      return ExitCode.Error;
    }
    this.emitElapsed = false;
    const roots = this.roots.length > 0 ? this.roots : ['.'];
    // `--watch-backend` is only meaningful in watch mode, so it is parsed
    // here (not in `run()`) which keeps it silently ignored on a
    // non-watching `sm scan`. An invalid value exits 2.
    const watchBackend = parseWatchBackend(this.watchBackend, this.context.stderr, this.noColor);
    if (watchBackend === null) return ExitCode.Error;
    // `--max-scan` / `--max-nodes` were already validated in `run()`;
    // re-parse here is a cheap pass-through (Number coercion + integer
    // check).
    const caps = this.parseCapFlags();
    return runWatchLoop({
      roots,
      json: this.json,
      noTokens: this.noTokens,
      strict: this.strict,
      noColor: this.noColor,
      db: this.db,
      noPlugins: this.noPlugins,
      context: this.context,
      printer: this.printer!,
      ...(caps.kind === 'ok' ? capOverrides(caps) : {}),
      ...(watchBackend !== undefined ? { watchBackend } : {}),
    });
  }

  /**
   * Detect the first `--watch` combo conflict in flag-declaration order
   * and return the catalog entries (full template + dim hint) that
   * `runWatchAlias` renders for it. Returns `null` when no conflict
   * is active. Order matches the historic message so reading the
   * branch top-down still tells the user which flag fired first.
   */
  #firstWatchConflict(): { template: string; hint: string } | null {
    if (this.noBuiltIns) {
      return { template: SCAN_TEXTS.watchVsNoBuiltIns, hint: SCAN_TEXTS.watchVsNoBuiltInsHint };
    }
    if (this.dryRun) {
      return { template: SCAN_TEXTS.watchVsDryRun, hint: SCAN_TEXTS.watchVsDryRunHint };
    }
    if (this.changed) {
      return { template: SCAN_TEXTS.watchVsChanged, hint: SCAN_TEXTS.watchVsChangedHint };
    }
    if (this.allowEmpty) {
      return { template: SCAN_TEXTS.watchVsAllowEmpty, hint: SCAN_TEXTS.watchVsAllowEmptyHint };
    }
    return null;
  }

  /** Render the failure branch of `TScanRunResult` to stderr. */
  private renderFailure(
    outcome: Exclude<Awaited<ReturnType<typeof runScanForCommand>>, { kind: 'ok' }>,
  ): number {
    const ansi = this.ansiFor('stderr');
    const errGlyph = ansi.red('✕');
    if (outcome.kind === 'guard-trip') {
      this.printer!.error(
        tx(SCAN_TEXTS.guardWipeRefused, {
          glyph: errGlyph,
          existing: outcome.existing,
          hint: ansi.dim(SCAN_TEXTS.guardWipeRefusedHint),
        }),
      );
      return ExitCode.Error;
    }
    if (outcome.kind === 'ambiguous-provider') {
      // Ambiguous activeProvider under --yes. Exit 2 per
      // `spec/cli-contract.md` §Auto-detect ("fails with exit code 2
      // under `--yes`"); `ExitCode.Error` (2) is the "bad usage"
      // semantic the spec calls for. The runner returned a
      // pre-formatted §3.1b error block (glyph + headline + dim hint),
      // so this surface prints it verbatim instead of wrapping it in
      // another `{glyph}  sm scan: {message}` shell (which would
      // double the glyph).
      this.printer!.error(outcome.message);
      return ExitCode.Error;
    }
    this.printer!.error(
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
    result: ScanResult,
    persistedTo: string | null,
    dbPath: string,
    strict: boolean,
    lensAutoDetected: string | null | undefined,
  ): number {
    const exitCode = result.issues.some((i) => i.severity === 'error') ? ExitCode.Issues : ExitCode.Ok;

    if (this.json) {
      return this.#renderJsonOutcome(result, exitCode, strict);
    }

    const ansi = this.ansiFor('stdout');
    this.#announceAutoDetectedLens(lensAutoDetected);
    const cwd = defaultRuntimeContext().cwd;

    // Same block `sm init`'s first scan prints (`util/scan-summary.ts`).
    const lines = renderScanSummaryLines({
      result,
      persistedTo,
      ...(this.dryRun && !this.noBuiltIns ? { dbPathIfNotPersisted: dbPath } : {}),
      cwd,
      ansi,
    });
    for (const line of lines) this.printer!.data(line);
    this.maybePrintCapNotice(result, ansi);
    this.maybePrintSkippedFilesNotice(result, ansi);
    this.maybePrintRenderCapNotice(result, ansi);
    return exitCode;
  }

  /**
   * Surface a WARN when the walker skipped one or more files for
   * exceeding `scan.maxFileSizeBytes`. Lists every skipped file as
   * `path (humanSize)` and points the user at the two levers
   * (`scan.maxFileSizeBytes` to raise the limit, `.skillmapignore` to
   * exclude the path). Routed through `printer.warn` (stderr) because a
   * silently dropped file is degraded state the operator should read,
   * not a mid-flight progress line.
   */
  private maybePrintSkippedFilesNotice(
    result: ScanResult,
    ansi: IAnsi,
  ): void {
    const oversized = result.oversizedFiles ?? [];
    if ((result.stats.filesOversized ?? oversized.length) <= 0) return;
    const lines = formatOversizedFileRows(oversized).join('');
    this.printer!.warn(
      tx(SCAN_TEXTS.scanSkippedFilesNotice, {
        glyph: ansi.yellow('⚠'),
        count: String(oversized.length),
        noun: oversized.length === 1 ? SCAN_TEXTS.scanSkippedFileNounSingular : SCAN_TEXTS.scanSkippedFileNounPlural,
        files: lines,
        hint: ansi.dim(SCAN_TEXTS.scanSkippedFilesNoticeHint),
      }),
    );
  }

  /**
   * Surface the §Scan truncation notice when the walker actually
   * stopped accepting files because the walk ceiling (`scan.maxScan` or
   * the `--max-scan` override) was reached and extra files were dropped.
   * Fires on `result.scanTruncated`, the kernel sets it when the walker
   * hit the ceiling; a project with at most the ceiling many files ends
   * the loop naturally with `scanTruncated: false`, so the notice stays
   * silent.
   */
  private maybePrintCapNotice(
    result: ScanResult,
    ansi: IAnsi,
  ): void {
    if (result.scanTruncated !== true) return;
    const ceiling = result.scanCeiling;
    if (ceiling === undefined) return;
    const source = this.maxScan !== undefined ? '--max-scan' : 'scan.maxScan';
    this.printer!.info(
      tx(SCAN_TEXTS.scanCappedNotice, {
        glyph: ansi.yellow('⚠'),
        limit: String(ceiling),
        source,
        hint: ansi.dim(SCAN_TEXTS.scanCappedNoticeHint),
      }),
    );
  }

  /**
   * Surface the §Map render cap advisory when the scanned corpus has
   * more nodes than the effective render cap (`--max-nodes` override,
   * else `scan.maxNodes`, carried on `ScanResult.maxRenderNodes`). Unlike
   * the scan-ceiling notice this is benign: nothing was dropped, the full
   * corpus is persisted and reference-validated, only the graph view
   * paginates. Routed through `printer.info` (cyan glyph) so it reads as
   * a heads-up, not a problem, and is silenced under `--json`. Stays
   * silent on synthetic fixtures (no `maxRenderNodes`) and whenever the
   * corpus fits under the cap.
   */
  private maybePrintRenderCapNotice(
    result: ScanResult,
    ansi: IAnsi,
  ): void {
    const cap = result.maxRenderNodes;
    if (cap === undefined) return;
    const nodes = result.stats.nodesCount;
    if (nodes <= cap) return;
    const source = this.maxNodes !== undefined ? '--max-nodes' : 'scan.maxNodes';
    this.printer!.info(
      tx(SCAN_TEXTS.scanRenderCapNotice, {
        glyph: ansi.cyan('ℹ'),
        nodes: String(nodes),
        cap: String(cap),
        source,
        hint: ansi.dim(SCAN_TEXTS.scanRenderCapNoticeHint),
      }),
    );
  }

  /**
   * Print the lens auto-detect line on stdout (the SAME stream as the
   * scan summary) so the two never interleave on a tty. The bootstrap
   * deliberately no longer prints this to stderr; the runner threads
   * `lensAutoDetected` through so the CLI announces it here, in order,
   * right before the summary. The text ends in a newline, so the
   * summary lands cleanly on its own line. No-op when the lens came
   * from config or no marker matched (`null` / `undefined`).
   */
  #announceAutoDetectedLens(lensAutoDetected: string | null | undefined): void {
    if (!lensAutoDetected) return;
    this.printer!.data(
      tx(SCAN_RUNNER_TEXTS.activeProviderAutodetected, { id: lensAutoDetected }),
    );
  }

  /**
   * `--json` output path. Under `--strict` (H4) self-validates the
   * ScanResult against `scan-result.schema.json` before emitting it,
   * catching drift a custom extractor could otherwise slip into stdout.
   */
  #renderJsonOutcome(
    result: ScanResult,
    exitCode: number,
    strict: boolean,
  ): number {
    if (strict) {
      const validators = loadSchemaValidators();
      const validation = validators.validate('scan-result', result);
      if (!validation.ok) {
        const ansi = this.ansiFor('stderr');
        // Pre-stringify the AJV error array, `tx`'s `{{var}}`
        // substitution funnels through `String(value)` which would
        // emit `[object Object]` for the raw `ErrorObject[]`. JSON
        // keeps the keys (`instancePath`, `keyword`, `message`, etc.)
        // intact for debugging while staying single-token in the
        // template.
        this.printer!.error(
          tx(SCAN_TEXTS.jsonSelfValidationFailed, {
            glyph: ansi.red('✕'),
            errors: JSON.stringify(validation.errors, null, 2),
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
 * Build the optional cap-override slots (`maxScan` / `maxNodes`) from a
 * parsed `parseCapFlags()` ok-result, omitting each slot when its flag
 * was absent. Spread by `run()` / `runWatchAlias()` so the two `??`
 * conditionals live in one place instead of inflating each call site's
 * cyclomatic complexity.
 */
function capOverrides(
  caps: { maxScan: number | undefined; maxNodes: number | undefined },
): { maxScan?: number; maxNodes?: number } {
  const out: { maxScan?: number; maxNodes?: number } = {};
  if (caps.maxScan !== undefined) out.maxScan = caps.maxScan;
  if (caps.maxNodes !== undefined) out.maxNodes = caps.maxNodes;
  return out;
}

/**
 * Usage analytics (opt-in, default OFF). Stash the set of extractors that
 * ran (third-party ids collapse to `external_plugin` at emit, presence
 * only) so the single `cli.<verb>` event emitted at exit carries it as
 * `extensions`. A FRESH lens resolution (markers autodetect, or the
 * ambiguity prompt's pick; never a config read) additionally rides as
 * `lens` + `lens_source`. See spec/telemetry.md §Usage event taxonomy.
 */
function stashScanUsage(
  executedExtensionIds: readonly string[],
  freshLens: string | null | undefined,
): void {
  addInvocationExtensions(executedExtensionIds);
  if (freshLens !== null && freshLens !== undefined) {
    setInvocationLens(freshLens, 'autodetect');
  }
}

