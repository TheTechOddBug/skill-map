/**
 * `sm watch [roots...]`, long-running incremental scan loop.
 *
 * Flow:
 *
 *   1. Load config + ignore filter + plugin runtime (delegated to
 *      `core/watcher/runtime.ts:createWatcherRuntime`).
 *   2. Run an initial incremental scan + persist, so the DB matches
 *      the current filesystem before the watcher fires anything.
 *   3. Subscribe via the runtime's chokidar wiring with
 *      `scan.watch.debounceMs` from config.
 *   4. On each debounced batch, the runtime re-runs the same
 *      scan+persist pipeline. This adapter prints one summary line
 *      (or one ScanResult ndjson record under `--json`) per batch.
 *   5. SIGINT / SIGTERM closes the watcher and exits 0. Operational
 *      errors during initial setup exit 2; per-batch errors are
 *      logged and the loop keeps running (a transient FS error must
 *      not kill a long-running watcher).
 *
 * `sm scan --watch` is an alias: `ScanCommand` detects the flag and
 * delegates here so we keep one implementation. The two surfaces share
 * the exit-code rule too, clean watcher shutdown is always 0,
 * regardless of per-batch issue severities.
 */


import { Command, Option } from 'clipanion';

import { createWatcherRuntime, type ICreateWatcherRuntimeOpts } from '../../core/watcher/runtime.js';
import { DB_DRIFT_TEXTS } from '../../core/sqlite/i18n/db-drift.texts.js';
import type { ScanResult } from '../../kernel/index.js';
import { formatOversizedFileRows } from '../../kernel/util/format-oversized.js';
import { tx } from '../../kernel/util/tx.js';
import { WATCH_TEXTS } from '../i18n/watch.texts.js';
import { ansiFor } from '../util/ansi.js';
import { createCliProgressEmitter } from '../util/cli-progress-emitter.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { tryParseNonNegativeInt } from '../util/option-validators.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { createPrinter, type IPrinter } from '../util/printer.js';
import { SmCommand } from '../util/sm-command.js';

export interface IRunWatchOptions {
  roots: string[];
  json: boolean;
  noTokens: boolean;
  strict: boolean;
  /**
   * Disable ANSI color codes (mirrors `SmCommand.noColor`). Forwarded
   * by the calling verb (`sm watch` and `sm scan --watch`) so the
   * watcher loop honours `--no-color` consistently with the rest of
   * the CLI surface.
   */
  noColor: boolean;
  /**
   * `--db <path>` override from the calling verb (escape hatch). Passed
   * through verbatim to `resolveDbPath(...)`; `undefined` means "use the
   * project default location".
   */
  db: string | undefined;
  /** Skip plugin discovery entirely. Step 9.1. */
  noPlugins?: boolean;
  context: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  };
  /**
   * Optional pre-built printer. When omitted, the watch loop builds
   * one inline from `context.stdout` / `context.stderr`. Verbs that
   * already own an `SmCommand` printer pass it through so a `--quiet`
   * invocation keeps `info` lines silenced consistently.
   */
  printer?: IPrinter;
  /** Test hook: when set, the watcher closes after this many batches. */
  maxBatches?: number;
  /**
   * Circuit breaker, after N consecutive batch failures the watcher
   * shuts down with exit 2. Defaults to 5. A successful batch resets
   * the counter. Set to 0 to disable the breaker (the historical
   * behaviour: log and continue forever).
   */
  maxConsecutiveFailures?: number;
  /**
   * Per-invocation override of `scan.maxScan` (`--max-scan <N>`), the
   * WALK-INTAKE ceiling. Passed through to
   * `ICreateWatcherRuntimeOpts.maxScanOverride`; `undefined` means "no
   * override". Bidirectional: any positive integer replaces the setting
   * for every batch this watcher fires.
   */
  maxScan?: number;
  /**
   * Per-invocation override of `scan.maxNodes` (`--max-nodes <N>`), the
   * MAP RENDER cap (does NOT bound the walk). Passed through to
   * `ICreateWatcherRuntimeOpts.maxNodesOverride`; `undefined` means "no
   * override". Bidirectional: any positive integer replaces the setting
   * for every batch this watcher fires.
   */
  maxNodes?: number;
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Shared implementation behind `sm watch` and `sm scan --watch`.
 * Returns the final process exit code.
 *
 * Now a thin Clipanion adapter over the shared `core/watcher/runtime.ts`
 * machinery, the heavy lifting (config load, plugin runtime, chokidar
 * subscription, prior-snapshot reuse, persist branch, breaker counter)
 * lives in the runtime. This adapter:
 *
 *   - parses CLI options into `ICreateWatcherRuntimeOpts`,
 *   - builds an `IPrinter` (default-or-passthrough) for human / JSON
 *     rendering,
 *   - wires runtime events to `printer.info` / `printer.warn` / stdout
 *     summaries,
 *   - owns SIGINT / SIGTERM and the final exit code.
 */
// Adapter glue: cfg preview load + runtime construction + signal
// handlers + post-stop bookkeeping. Branching is intrinsic to the
// lifecycle (json vs human render, initial vs follow-up batch,
// breaker on/off).
// eslint-disable-next-line complexity
export async function runWatchLoop(opts: IRunWatchOptions): Promise<number> {
  const { context } = opts;
  const printer = opts.printer ?? createPrinter({
    stdout: context.stdout,
    stderr: context.stderr,
  });
  const runtimeCtx = defaultRuntimeContext();
  const dbPath = resolveDbPath({ db: opts.db, ...runtimeCtx });
  const breakerLimit = opts.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  const stdoutTty = context.stdout as NodeJS.WriteStream;
  const ansi = ansiFor({ isTTY: stdoutTty.isTTY === true, noColorFlag: opts.noColor });
  const stderrTty = context.stderr as NodeJS.WriteStream;
  const stderrAnsi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: opts.noColor });
  const errGlyph = stderrAnsi.red('✕');

  let initialDone = false;
  const renderBatch = (result: ScanResult | undefined): void => {
    if (!result) return;
    if (opts.json) {
      context.stdout.write(JSON.stringify(result) + '\n');
    } else {
      const nodes = result.stats.nodesCount;
      const links = result.stats.linksCount;
      const issues = result.stats.issuesCount;
      context.stdout.write(
        tx(WATCH_TEXTS.scannedSummary, {
          glyph: ansi.green('✓'),
          nodes,
          nodesNoun: nodes === 1 ? WATCH_TEXTS.scannedNounNodeSingular : WATCH_TEXTS.scannedNounNodePlural,
          links,
          linksNoun: links === 1 ? WATCH_TEXTS.scannedNounLinkSingular : WATCH_TEXTS.scannedNounLinkPlural,
          issues,
          issuesNoun: issues === 1 ? WATCH_TEXTS.scannedNounIssueSingular : WATCH_TEXTS.scannedNounIssuePlural,
          durationTag: ansi.dim(tx(WATCH_TEXTS.scannedDurationTag, { ms: result.stats.durationMs })),
        }),
      );
    }
    // File-size skip WARN, per batch. Always to stderr (degraded state
    // the operator should read), regardless of `--json` since stdout
    // carries the ndjson record. Same shape as `sm scan`'s notice.
    renderOversizedWarning(result);
  };

  const renderOversizedWarning = (result: ScanResult): void => {
    const oversized = result.oversizedFiles ?? [];
    if ((result.stats.filesOversized ?? oversized.length) <= 0) return;
    const files = formatOversizedFileRows(oversized).join('');
    context.stderr.write(
      tx(WATCH_TEXTS.skippedFilesNotice, {
        glyph: stderrAnsi.yellow('⚠'),
        count: oversized.length,
        noun: oversized.length === 1 ? WATCH_TEXTS.skippedFileNounSingular : WATCH_TEXTS.skippedFileNounPlural,
        files,
        hint: stderrAnsi.dim(WATCH_TEXTS.skippedFilesNoticeHint),
      }),
    );
  };

  const runtimeOpts: ICreateWatcherRuntimeOpts = {
    dbPath,
    roots: opts.roots,
    runtimeContext: runtimeCtx,
    noBuiltIns: false,
    noPlugins: opts.noPlugins ?? false,
    strictOverride: opts.strict,
    tokenizeOverride: !opts.noTokens,
    emitterFactory: () => createCliProgressEmitter(context.stderr),
    runInitialBatch: true,
    // CLI ordering: initial scan first, then subscribe. Matches the
    // historic `runWatchLoop` shape, events arriving during the
    // initial scan are intentionally lost (the next user save covers
    // any race).
    subscribeBeforeInitial: false,
    // Initial-scan failure exits 2; failOnInitialBatchError makes the
    // runtime re-throw so `start()` rejects and we map to ExitCode.Error.
    failOnInitialBatchError: true,
    circuitBreaker: { maxConsecutiveFailures: breakerLimit },
    killSwitches: readConformanceKillSwitches(),
    ...(opts.maxBatches !== undefined ? { maxBatches: opts.maxBatches } : {}),
    ...(opts.maxScan !== undefined ? { maxScanOverride: opts.maxScan } : {}),
    ...(opts.maxNodes !== undefined ? { maxNodesOverride: opts.maxNodes } : {}),
    events: {
      onBatch: (outcome) => {
        if (outcome.kind === 'ok') {
          renderBatch(outcome.result);
          initialDone = true;
        } else {
          // Per-batch (post-initial) failure prints `batchFailed`. The
          // initial-scan failure is handled by the `start()` reject
          // path below and uses `initialScanFailed` instead.
          if (initialDone) {
            context.stderr.write(
              tx(WATCH_TEXTS.batchFailed, { glyph: errGlyph, message: outcome.message }),
            );
          }
        }
      },
      onWatcherError: (message) => {
        // chokidar transport-level error, surface via the templated
        // `watcherError` line so the historic grep prefix is preserved.
        context.stderr.write(tx(WATCH_TEXTS.watcherError, { glyph: errGlyph, message }));
      },
      onPluginWarning: (message) => {
        // Plugin-load warnings flow through `printer.warn` verbatim
        // (the formatter is the plugin runtime's `formatWarning`,
        // no extra framing needed).
        printer.warn(`${message}\n`);
      },
      onDriftReset: (info) => {
        // Pre-1.0 schema-drift rebuild ran on watcher boot. Surface the
        // receipt so the silent wipe is visible. See spec/db-schema.md
        // §Schema drift (pre-1.0).
        context.stderr.write(
          tx(DB_DRIFT_TEXTS.driftReset, {
            glyph: stderrAnsi.yellow('⚠'),
            dbVersion: info.dbVersion,
            currentVersion: info.currentVersion,
            hint: stderrAnsi.dim(DB_DRIFT_TEXTS.driftResetHint),
          }),
        );
      },
      onConfigLoaded: ({ debounceMs }) => {
        if (opts.json) return;
        // Resolved debounce comes straight from the runtime, single
        // source of truth, no redundant `loadConfig` call here.
        context.stderr.write(
          tx(WATCH_TEXTS.starting, { rootsCount: opts.roots.length, debounceMs }),
        );
      },
      onReady: (info) => {
        if (!opts.json) {
          context.stderr.write(tx(WATCH_TEXTS.ready));
        }
        // Suppress unused-args warning while keeping the shape obvious.
        void info;
      },
      onBreakerTripped: (count, message) => {
        context.stderr.write(
          tx(WATCH_TEXTS.breakerTripped, {
            glyph: errGlyph,
            count,
            hint: stderrAnsi.dim(tx(WATCH_TEXTS.breakerTrippedHint, { message })),
          }),
        );
      },
    },
  };

  const handle = createWatcherRuntime(runtimeOpts);

  let exitCode: number = ExitCode.Ok;
  let stopRequested = false;
  const onSignal = (): void => {
    if (stopRequested) return;
    stopRequested = true;
    void handle.stop();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await handle.start();
  } catch (err) {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    const message = err instanceof Error ? err.message : String(err);
    context.stderr.write(tx(WATCH_TEXTS.initialScanFailed, { glyph: errGlyph, message }));
    return ExitCode.Error;
  }

  await handle.whenStopped;
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  if (handle.outcome() === 'breaker-tripped') {
    exitCode = ExitCode.Error;
  }
  // The runtime closes its chokidar handles on every shutdown path
  // (breaker-tripped, maxBatches, signal-driven `stop()`, initial-batch
  // failure with `failOnInitialError`) BEFORE resolving `whenStopped`,
  // so no defensive `handle.stop()` is needed here (audit m9).

  if (!opts.json) {
    // `batchCount` excludes the initial scan, the runtime increments
    // only inside the chokidar onBatch path, which mirrors the
    // historic CLI bookkeeping.
    context.stderr.write(tx(WATCH_TEXTS.stopped, { batchCount: handle.batchCount() }));
  }
  return exitCode;
}

export class WatchCommand extends SmCommand {
  static override paths = [['watch']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Watch roots and run an incremental scan after each debounced batch of filesystem events.',
    details: `
      Long-running version of 'sm scan --changed'. Subscribes to the
      given roots via chokidar, applies the same ignore chain
      (.skillmapignore + config.ignore + bundled defaults), and
      triggers an incremental scan after each debounced batch.

      Default debounce is 300ms; configure via 'scan.watch.debounceMs'
      in .skill-map/settings.json. SIGINT / SIGTERM stop the watcher
      cleanly and exit 0.

      Under --json, every batch emits one ScanResult as ndjson on
      stdout. Without --json, every batch prints one summary line.

      'sm scan --watch' is an alias and shares the same flag surface.
    `,
    examples: [
      ['Watch the current directory', '$0 watch'],
      ['Watch multiple roots', '$0 watch ./docs ./skills'],
      ['Stream ScanResult per batch as ndjson', '$0 watch --json'],
    ],
  });

  roots = Option.Rest({ name: 'roots' });
  noTokens = Option.Boolean('--no-tokens', false, {
    description: 'Skip per-node token counts (cl100k_base BPE).',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Promote frontmatter-validation findings from warn to error inside each batch. Does not change the watcher exit code.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery for the watcher session.',
  });
  maxConsecutiveFailures = Option.String('--max-consecutive-failures', {
    required: false,
    description:
      'Shut down with exit 2 after N consecutive batch failures (default 5; 0 disables the breaker).',
  });
  maxScan = Option.String('--max-scan', {
    required: false,
    description:
      'Per-batch override of scan.maxScan (default 50000), the WALK-INTAKE ceiling. The scan walks, parses, analyzes, and reference-validates the full corpus up to this number. Bidirectional: raises OR lowers the ceiling. When a batch hits it, additional files are dropped in stable order and the UI surfaces the persistent truncation banner. Validation: integer >= 1.',
  });
  maxNodes = Option.String('--max-nodes', {
    required: false,
    description:
      'Per-batch override of scan.maxNodes (default 256), the MAP RENDER cap (pure metadata): it does NOT bound the scan, only the graph projection. Bidirectional: raises OR lowers the render cap. Validation: integer >= 1.',
  });

  // Long-running verb, the watcher prints its own "stopped" line on
  // SIGINT / SIGTERM. Adding `done in <…>` after that would be noise.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const roots = this.roots.length > 0 ? this.roots : ['.'];
    const breaker = parseBreakerLimit(this.maxConsecutiveFailures, this.context.stderr, this.noColor);
    if (breaker === null) return ExitCode.Error;
    const maxScan = parseMaxScanLimit(this.maxScan, this.context.stderr, this.noColor);
    if (maxScan === null) return ExitCode.Error;
    const maxNodes = parseMaxNodesLimit(this.maxNodes, this.context.stderr, this.noColor);
    if (maxNodes === null) return ExitCode.Error;
    const watchOpts: IRunWatchOptions = {
      roots,
      json: this.json,
      noTokens: this.noTokens,
      strict: this.strict,
      noColor: this.noColor,
      db: this.db,
      noPlugins: this.noPlugins,
      context: this.context,
      printer: this.printer!,
    };
    if (breaker !== undefined) watchOpts.maxConsecutiveFailures = breaker;
    if (maxScan !== undefined) watchOpts.maxScan = maxScan;
    if (maxNodes !== undefined) watchOpts.maxNodes = maxNodes;
    return runWatchLoop(watchOpts);
  }
}

/**
 * Parse the raw `--max-consecutive-failures <n>` flag value. Returns
 * `undefined` when the flag is absent (caller falls through to the
 * default), `null` when the value is invalid (caller exits 2), or the
 * parsed non-negative integer otherwise.
 */
function parseBreakerLimit(
  raw: string | undefined,
  stderr: NodeJS.WritableStream,
  noColor: boolean,
): number | undefined | null {
  if (raw === undefined) return undefined;
  const parsed = tryParseNonNegativeInt(raw);
  if (parsed === null) {
    const stderrTty = stderr as NodeJS.WriteStream & { isTTY?: boolean };
    const ansi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: noColor });
    stderr.write(
      tx(WATCH_TEXTS.maxConsecutiveFailuresInvalid, {
        glyph: ansi.red('✕'),
        raw,
        hint: ansi.dim(WATCH_TEXTS.maxConsecutiveFailuresInvalidHint),
      }),
    );
    return null;
  }
  return parsed;
}

/**
 * Parse the raw `--max-scan <n>` flag value (the walk ceiling). Returns
 * `undefined` when the flag is absent (caller falls through to
 * `scan.maxScan` per-batch), `null` when the value is invalid (caller
 * exits 2), or the parsed positive integer otherwise.
 */
function parseMaxScanLimit(
  raw: string | undefined,
  stderr: NodeJS.WritableStream,
  noColor: boolean,
): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    const stderrTty = stderr as NodeJS.WriteStream & { isTTY?: boolean };
    const ansi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: noColor });
    stderr.write(
      tx(WATCH_TEXTS.maxScanInvalid, {
        glyph: ansi.red('✕'),
        raw,
        hint: ansi.dim(WATCH_TEXTS.maxScanInvalidHint),
      }),
    );
    return null;
  }
  return n;
}

/**
 * Parse the raw `--max-nodes <n>` flag value (the render cap). Returns
 * `undefined` when the flag is absent (caller falls through to
 * `scan.maxNodes` per-batch), `null` when the value is invalid (caller
 * exits 2), or the parsed positive integer otherwise.
 */
function parseMaxNodesLimit(
  raw: string | undefined,
  stderr: NodeJS.WritableStream,
  noColor: boolean,
): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    const stderrTty = stderr as NodeJS.WriteStream & { isTTY?: boolean };
    const ansi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: noColor });
    stderr.write(
      tx(WATCH_TEXTS.maxNodesInvalid, {
        glyph: ansi.red('✕'),
        raw,
        hint: ansi.dim(WATCH_TEXTS.maxNodesInvalidHint),
      }),
    );
    return null;
  }
  return n;
}
