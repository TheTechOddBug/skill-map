/**
 * `sm history [-n <path>] [--action <id>] [--status <s,...>] [--since <ISO>] [--until <ISO>] [--json]`
 * `sm history stats [--since <ISO>] [--until <ISO>] [--period day|week|month] [--top N] [--json]`
 *
 * Read-side surfaces over `state_executions`. Step 5.3 ships the lister;
 * Step 5.4 ships the aggregator. Both share the date-window parsing and
 * the elapsed-time helpers.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok (including empty result)
 *   2  bad flag (unparseable date, unknown status, invalid --top)
 *   5  DB file missing, run `sm scan` first
 */

import { Command, Option } from 'clipanion';

import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import type {
  IListExecutionsFilter,
  THistoryStatsPeriod,
} from '../../kernel/ports/storage.js';
import type {
  ExecutionRecord,
  ExecutionStatus,
  HistoryStats,
} from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { truncateHead } from '../util/text.js';
import type { IAnsi } from '../util/ansi.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { formatElapsed } from '../util/elapsed.js';
import { ExitCode } from '../util/exit-codes.js';
import { parsePositiveIntegerOption } from '../util/option-validators.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';
import { HISTORY_TEXTS } from '../i18n/history.texts.js';

const STATUSES: readonly ExecutionStatus[] = ['completed', 'failed', 'cancelled'];
const PERIODS: readonly THistoryStatsPeriod[] = ['day', 'week', 'month'];

// --- helpers ---------------------------------------------------------------

/**
 * Parse an ISO-8601 string into Unix ms. Rejects unparseable input via
 * stderr + exit 2, caller propagates the return value.
 *
 * Returns `null` on parse error so callers can short-circuit.
 */
function parseIsoMs(
  input: string,
  flag: string,
  stderr: NodeJS.WritableStream,
  ansi: IAnsi,
): number | null {
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) {
    stderr.write(
      tx(HISTORY_TEXTS.invalidIsoDateTime, { glyph: ansi.red('✕'), flag, value: input }),
    );
    return null;
  }
  return ms;
}

function parseStatuses(
  input: string,
  stderr: NodeJS.WritableStream,
  ansi: IAnsi,
): ExecutionStatus[] | null {
  const errGlyph = ansi.red('✕');
  const parts = input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    stderr.write(
      tx(HISTORY_TEXTS.statusEmpty, {
        glyph: errGlyph,
        hint: ansi.dim(tx(HISTORY_TEXTS.statusEmptyHint, { allowed: STATUSES.join(', ') })),
      }),
    );
    return null;
  }
  for (const p of parts) {
    if (!STATUSES.includes(p as ExecutionStatus)) {
      stderr.write(
        tx(HISTORY_TEXTS.statusInvalid, {
          glyph: errGlyph,
          value: p,
          hint: ansi.dim(tx(HISTORY_TEXTS.statusInvalidHint, { allowed: STATUSES.join(', ') })),
        }),
      );
      return null;
    }
  }
  return parts as ExecutionStatus[];
}

// --- sm history ------------------------------------------------------------

export class HistoryCommand extends SmCommand {
  static override paths = [['history']];
  static override usage = Command.Usage({
    category: 'History',
    description:
      'Filter execution records. --json emits an array conforming to execution-record.schema.json.',
    details: `
      Reads from state_executions. Filters:
        -n <path>          restrict to executions whose nodeIds[] contains <path>
        --action <id>      restrict to a specific action extension id
        --status <s,...>   restrict to one or more of completed,failed,cancelled
        --since <ISO>      lower bound on startedAt (inclusive, ISO-8601)
        --until <ISO>      upper bound on startedAt (exclusive, ISO-8601)
        --limit N          cap result count

      Output is most-recent-first. Run \`sm scan\` first to provision the DB.
    `,
    examples: [
      ['Recent executions', '$0 history --limit 10'],
      ['Failures in the last week', '$0 history --status failed --since 2026-04-19T00:00:00Z'],
      ['Machine-readable, scoped to one node', '$0 history -n skills/foo.md --json'],
    ],
  });

  node = Option.String('-n', { required: false });
  action = Option.String('--action', { required: false });
  status = Option.String('--status', { required: false });
  since = Option.String('--since', { required: false });
  until = Option.String('--until', { required: false });
  limit = Option.String('--limit', { required: false });

  // CLI list verb: many optional filter flags (`--node`, `--action`,
  // `--status`, `--since`, `--until`, `--limit`, `--json`, `--quiet`)
  // each adding a guarded mutation to the filter or render path. Each
  // branch is single-purpose; splitting per flag would distance the
  // validations from the filter they shape.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const stderrAnsi = this.ansiFor('stderr');
    // --- flag validation -------------------------------------------------
    const filter: IListExecutionsFilter = {};
    if (this.node !== undefined) filter.nodePath = this.node;
    if (this.action !== undefined) filter.actionId = this.action;
    if (this.status !== undefined) {
      const parsed = parseStatuses(this.status, this.context.stderr, stderrAnsi);
      if (parsed === null) return ExitCode.Error;
      filter.statuses = parsed;
    }
    if (this.since !== undefined) {
      const ms = parseIsoMs(this.since, '--since', this.context.stderr, stderrAnsi);
      if (ms === null) return ExitCode.Error;
      filter.sinceMs = ms;
    }
    if (this.until !== undefined) {
      const ms = parseIsoMs(this.until, '--until', this.context.stderr, stderrAnsi);
      if (ms === null) return ExitCode.Error;
      filter.untilMs = ms;
    }
    if (this.limit !== undefined) {
      const parsed = parsePositiveIntegerOption(this.limit, '--limit', this.context.stderr);
      if (parsed === null) return ExitCode.Error;
      filter.limit = parsed;
    }

    // --- DB --------------------------------------------------------------
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const rows = await adapter.history.list(filter);

      if (this.json) {
        // Array output, no top-level elapsedMs per cli-contract.md
        // §Elapsed time. The `done in <…>` stderr line still fires.
        this.printer!.data(JSON.stringify(rows.map(toExecutionRecord)) + '\n');
      } else if (rows.length === 0) {
        this.printer!.data(HISTORY_TEXTS.noExecutionsFound);
      } else {
        const ansi = this.ansiFor('stdout');
        this.printer!.data(renderTable(rows, ansi));
      }
      return ExitCode.Ok;
    });
  }
}

// --- sm history stats ------------------------------------------------------

export class HistoryStatsCommand extends SmCommand {
  static override paths = [['history', 'stats']];
  static override usage = Command.Usage({
    category: 'History',
    description:
      'Aggregate counts, tokens, periods, top nodes, and error rates over state_executions. --json conforms to history-stats.schema.json.',
    details: `
      Defaults: --period month, --top 10, all-time when --since omitted.

      Window: --since is inclusive, --until is exclusive. Both ISO-8601.

      The --json output ALWAYS includes the full per-failure-reason key
      set (zero-filled if a reason has no occurrences) so dashboards see
      a predictable shape.
    `,
    examples: [
      ['All-time stats', '$0 history stats'],
      ['Last 30 days, daily buckets', '$0 history stats --since 2026-03-26T00:00:00Z --period day'],
      ['Top 5 nodes, JSON', '$0 history stats --top 5 --json'],
    ],
  });

  since = Option.String('--since', { required: false });
  until = Option.String('--until', { required: false });
  period = Option.String('--period', { required: false });
  top = Option.String('--top', { required: false });

  // CLI stats verb: range parsing + window flags + period flag + JSON
  // branch + per-period iteration. Each branch is a single-purpose
  // gate; the data work lives in `aggregateHistoryStats`.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const elapsed = this.elapsed!;
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    // --- flag validation -------------------------------------------------
    let sinceMs: number | null = null;
    let untilMs: number = Date.now();
    if (this.since !== undefined) {
      const parsed = parseIsoMs(this.since, '--since', this.context.stderr, stderrAnsi);
      if (parsed === null) return ExitCode.Error;
      sinceMs = parsed;
    }
    if (this.until !== undefined) {
      const parsed = parseIsoMs(this.until, '--until', this.context.stderr, stderrAnsi);
      if (parsed === null) return ExitCode.Error;
      untilMs = parsed;
    }
    let period: THistoryStatsPeriod = 'month';
    if (this.period !== undefined) {
      if (!PERIODS.includes(this.period as THistoryStatsPeriod)) {
        this.printer!.error(
          tx(HISTORY_TEXTS.periodInvalid, {
            glyph: errGlyph,
            value: this.period,
            hint: stderrAnsi.dim(
              tx(HISTORY_TEXTS.periodInvalidHint, { allowed: PERIODS.join(', ') }),
            ),
          }),
        );
        return ExitCode.Error;
      }
      period = this.period as THistoryStatsPeriod;
    }
    let topN = 10;
    if (this.top !== undefined) {
      const parsed = parsePositiveIntegerOption(this.top, '--top', this.context.stderr);
      if (parsed === null) return ExitCode.Error;
      topN = parsed;
    }

    // --- DB --------------------------------------------------------------
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const aggregated = await adapter.history.aggregateStats(
        { sinceMs, untilMs },
        period,
        topN,
      );

      const stats: HistoryStats = {
        schemaVersion: 1,
        range: {
          since: sinceMs === null ? null : new Date(sinceMs).toISOString(),
          until: new Date(untilMs).toISOString(),
        },
        totals: aggregated.totals,
        tokensPerAction: aggregated.tokensPerAction,
        executionsPerPeriod: aggregated.executionsPerPeriod,
        topNodes: aggregated.topNodes,
        errorRates: aggregated.errorRates,
        elapsedMs: elapsed.ms(),
      };

      if (this.json) {
        // Self-validate against history-stats.schema.json so a runtime
        // shape regression is caught at the boundary (existing pattern
        // from src/test/self-scan.test.ts).
        const validators = loadSchemaValidators();
        // Step 5.10: re-stamp `elapsedMs` after the validator load
        // (which dominates wall-clock at cold start, ~100ms in cold-cache
        // CLI runs). Captured at construction time, the field understated
        // the user-perceived duration vs `done in <…>` on stderr by the
        // schema-load delta. Doing it after validate but before serialise
        // captures the heavy work; serialisation itself is microseconds.
        stats.elapsedMs = elapsed.ms();
        const result = validators.validate('history-stats', stats);
        if (!result.ok) {
          this.printer!.error(
            tx(HISTORY_TEXTS.schemaValidationFailed, {
              glyph: errGlyph,
              errors: String(result.errors),
            }),
          );
          return ExitCode.Error;
        }
        this.printer!.data(JSON.stringify(stats) + '\n');
      } else {
        const ansi = this.ansiFor('stdout');
        this.printer!.data(renderStats(stats, ansi));
      }
      return ExitCode.Ok;
    });
  }
}

// --- renderers -------------------------------------------------------------

const COL_ID_MAX = 26;
const COL_ACTION_MAX = 28;
const ROW_INDENT = '  ';

function toExecutionRecord(r: ExecutionRecord): ExecutionRecord {
  // listExecutions already returns the camelCased domain shape; we just
  // emit it as-is. The function name advertises intent for the JSON path.
  return r;
}

interface IHistoryRow {
  id: string;
  started: string;
  action: string;
  status: string;
  duration: string;
  tokens: string;
  nodes: string;
  isError: boolean;
  isCancelled: boolean;
}

function toHistoryRow(r: ExecutionRecord): IHistoryRow {
  // Defence in depth: `id`, `extensionId`, and `failureReason` are
  // sourced from rows persisted by extension code; sanitize before
  // rendering so a hostile plugin cannot inject terminal escapes via
  // its own action ids or failure reasons.
  const tokens = `${r.tokensIn ?? 0}/${r.tokensOut ?? 0}`;
  const duration = r.durationMs === null || r.durationMs === undefined
    ? '-'
    : formatElapsed(r.durationMs);
  const reason = sanitizeForTerminal(r.failureReason ?? '');
  const status = reason.length > 0
    ? tx(HISTORY_TEXTS.statusWithReason, { status: r.status, reason })
    : r.status;
  return {
    id: truncateHead(sanitizeForTerminal(r.id), COL_ID_MAX),
    // ISO timestamp with the `T` swapped for a space, keeps the column
    // narrow and human-readable without losing the `Z` UTC marker.
    started: new Date(r.startedAt).toISOString().slice(0, 19).replace('T', ' ') + 'Z',
    action: truncateHead(sanitizeForTerminal(r.extensionId), COL_ACTION_MAX),
    status,
    duration,
    tokens,
    nodes: String((r.nodeIds ?? []).length),
    isError: r.status === 'failed',
    isCancelled: r.status === 'cancelled',
  };
}

interface IHistoryColWidths {
  id: number;
  started: number;
  action: number;
  status: number;
  duration: number;
  tokens: number;
  nodes: number;
}

function computeHistoryWidths(rows: IHistoryRow[]): IHistoryColWidths {
  const cmp = (label: string, ...vals: string[]): number =>
    Math.max(label.length, ...vals.map((v) => v.length));
  return {
    id: cmp(HISTORY_TEXTS.tableHeaderId, ...rows.map((r) => r.id)),
    started: cmp(HISTORY_TEXTS.tableHeaderStarted, ...rows.map((r) => r.started)),
    action: cmp(HISTORY_TEXTS.tableHeaderAction, ...rows.map((r) => r.action)),
    status: cmp(HISTORY_TEXTS.tableHeaderStatus, ...rows.map((r) => r.status)),
    duration: cmp(HISTORY_TEXTS.tableHeaderDuration, ...rows.map((r) => r.duration)),
    tokens: cmp(HISTORY_TEXTS.tableHeaderTokens, ...rows.map((r) => r.tokens)),
    nodes: cmp(HISTORY_TEXTS.tableHeaderNodes, ...rows.map((r) => r.nodes)),
  };
}

/**
 * Render the human-mode table. Mirrors `sm list`'s rhythm: 2-space
 * indent, no `-` separator, dim header / metadata columns, status
 * column colored red on `failed` and yellow on `cancelled`. Footer
 * carries the count and a tip pointing at `sm history stats`.
 */
function renderTable(records: ExecutionRecord[], ansi: IAnsi): string {
  const rows = records.map(toHistoryRow);
  const w = computeHistoryWidths(rows);
  const lines: string[] = [];
  lines.push(formatHistoryHeader(w, ansi));
  for (const r of rows) lines.push(formatHistoryRow(r, w, ansi));
  lines.push('');
  const noun = records.length === 1
    ? HISTORY_TEXTS.tableFooterNounSingular
    : HISTORY_TEXTS.tableFooterNounPlural;
  lines.push(
    tx(HISTORY_TEXTS.tableFooterCount, { count: records.length, noun }).trimEnd(),
  );
  lines.push(ansi.dim(HISTORY_TEXTS.tableFooterTip.trimEnd()));
  return lines.join('\n') + '\n';
}

function formatHistoryHeader(w: IHistoryColWidths, ansi: IAnsi): string {
  return ROW_INDENT + [
    ansi.dim(HISTORY_TEXTS.tableHeaderId.padEnd(w.id)),
    ansi.dim(HISTORY_TEXTS.tableHeaderStarted.padEnd(w.started)),
    ansi.dim(HISTORY_TEXTS.tableHeaderAction.padEnd(w.action)),
    ansi.dim(HISTORY_TEXTS.tableHeaderStatus.padEnd(w.status)),
    ansi.dim(HISTORY_TEXTS.tableHeaderDuration.padStart(w.duration)),
    ansi.dim(HISTORY_TEXTS.tableHeaderTokens.padStart(w.tokens)),
    ansi.dim(HISTORY_TEXTS.tableHeaderNodes.padStart(w.nodes)),
  ].join('  ');
}

function formatHistoryRow(r: IHistoryRow, w: IHistoryColWidths, ansi: IAnsi): string {
  const status = r.status.padEnd(w.status);
  const colorStatus = r.isError ? ansi.red(status) : r.isCancelled ? ansi.yellow(status) : status;
  return ROW_INDENT + [
    r.id.padEnd(w.id),
    ansi.dim(r.started.padEnd(w.started)),
    r.action.padEnd(w.action),
    colorStatus,
    ansi.dim(r.duration.padStart(w.duration)),
    r.tokens.padStart(w.tokens),
    ansi.dim(r.nodes.padStart(w.nodes)),
  ].join('  ');
}

/**
 * Render the human-mode stats. Sectioned layout matching `sm plugins
 * doctor` / `sm config list`: dense one-line summary + indented
 * `Window` / `Totals` / `Top actions` / `Top nodes` / `Failures`
 * blocks. Empty top-action / top-node / failure sections drop.
 */
function renderStats(stats: HistoryStats, ansi: IAnsi): string {
  const out: string[] = [];
  const errorPct = (stats.errorRates.global * 100).toFixed(1);
  const failedPart = stats.totals.failedCount > 0
    ? ansi.red(`${stats.totals.failedCount} failed`)
    : ansi.dim(`${stats.totals.failedCount} failed`);
  out.push(
    tx(HISTORY_TEXTS.statsHeader, {
      summary: `${stats.totals.executionsCount} executions  ·  ${failedPart}  ·  ${errorPct}% error rate`,
    }),
  );

  out.push(...renderStatsWindow(stats, ansi));
  out.push(...renderStatsTotals(stats, ansi));
  if (stats.tokensPerAction.length > 0) out.push(...renderStatsTopActions(stats, ansi));
  if (stats.topNodes.length > 0) out.push(...renderStatsTopNodes(stats, ansi));
  const failures = Object.entries(stats.errorRates.perFailureReason).filter(([, v]) => v > 0);
  if (failures.length > 0) out.push(...renderStatsFailures(failures, ansi));
  return out.join('');
}

function renderStatsWindow(stats: HistoryStats, ansi: IAnsi): string[] {
  const since = stats.range.since
    ? trimMs(stats.range.since)
    : HISTORY_TEXTS.statsAllTimeWindow;
  const until = trimMs(stats.range.until);
  const labelWidth = Math.max(HISTORY_TEXTS.statsLabelSince.length, HISTORY_TEXTS.statsLabelUntil.length);
  return [
    tx(HISTORY_TEXTS.statsSectionHeader, { title: HISTORY_TEXTS.statsSectionTitleWindow }),
    tx(HISTORY_TEXTS.statsFieldRow, {
      label: ansi.dim(HISTORY_TEXTS.statsLabelSince.padEnd(labelWidth)),
      value: since,
    }),
    tx(HISTORY_TEXTS.statsFieldRow, {
      label: ansi.dim(HISTORY_TEXTS.statsLabelUntil.padEnd(labelWidth)),
      value: until,
    }),
    '\n',
  ];
}

function renderStatsTotals(stats: HistoryStats, ansi: IAnsi): string[] {
  const labelWidth = Math.max(
    HISTORY_TEXTS.statsLabelExecutions.length,
    HISTORY_TEXTS.statsLabelTokens.length,
    HISTORY_TEXTS.statsLabelDuration.length,
  );
  const breakdown = formatExecBreakdown(stats, ansi);
  return [
    tx(HISTORY_TEXTS.statsSectionHeader, { title: HISTORY_TEXTS.statsSectionTitleTotals }),
    tx(HISTORY_TEXTS.statsFieldRow, {
      label: ansi.dim(HISTORY_TEXTS.statsLabelExecutions.padEnd(labelWidth)),
      value: tx(HISTORY_TEXTS.statsExecutionsCount, {
        count: stats.totals.executionsCount,
        breakdown,
      }),
    }),
    tx(HISTORY_TEXTS.statsFieldRow, {
      label: ansi.dim(HISTORY_TEXTS.statsLabelTokens.padEnd(labelWidth)),
      value: tx(HISTORY_TEXTS.statsTokensSplit, {
        in: stats.totals.tokensIn,
        out: stats.totals.tokensOut,
      }),
    }),
    tx(HISTORY_TEXTS.statsFieldRow, {
      label: ansi.dim(HISTORY_TEXTS.statsLabelDuration.padEnd(labelWidth)),
      value: formatElapsed(stats.totals.durationMsTotal),
    }),
    '\n',
  ];
}

function formatExecBreakdown(stats: HistoryStats, ansi: IAnsi): string {
  const parts: string[] = [];
  if (stats.totals.completedCount > 0) parts.push(ansi.green(`${stats.totals.completedCount} ok`));
  if (stats.totals.failedCount > 0) parts.push(ansi.red(`${stats.totals.failedCount} failed`));
  const cancelled = stats.totals.executionsCount - stats.totals.completedCount - stats.totals.failedCount;
  if (cancelled > 0) parts.push(ansi.yellow(`${cancelled} cancelled`));
  return parts.length === 0 ? '' : ` (${parts.join(' · ')})`;
}

function renderStatsTopActions(stats: HistoryStats, ansi: IAnsi): string[] {
  const lines: string[] = [
    tx(HISTORY_TEXTS.statsSectionHeader, { title: HISTORY_TEXTS.statsSectionTitleTopActions }),
  ];
  // Defence in depth: `actionId` / `actionVersion` come from extension
  // code persisted in `state_executions`; sanitize before interpolation.
  const formatted = stats.tokensPerAction.slice(0, 5).map((a) => ({
    id: `${sanitizeForTerminal(a.actionId)}@${sanitizeForTerminal(a.actionVersion)}`,
    runs: a.executionsCount,
    tokens: tx(HISTORY_TEXTS.statsTokensSplit, { in: a.tokensIn, out: a.tokensOut }),
  }));
  const idWidth = Math.max(...formatted.map((a) => a.id.length));
  for (const a of formatted) {
    lines.push(
      tx(HISTORY_TEXTS.statsTopActionsRow, {
        id: a.id.padEnd(idWidth),
        runs: a.runs,
        runsLabel: a.runs === 1 ? HISTORY_TEXTS.statsRunsSingular : HISTORY_TEXTS.statsRunsPlural,
        tokens: ansi.dim(a.tokens),
      }),
    );
  }
  lines.push('\n');
  return lines;
}

function renderStatsTopNodes(stats: HistoryStats, ansi: IAnsi): string[] {
  const lines: string[] = [
    tx(HISTORY_TEXTS.statsSectionHeader, { title: HISTORY_TEXTS.statsSectionTitleTopNodes }),
  ];
  const formatted = stats.topNodes.slice(0, 5).map((n) => ({
    path: sanitizeForTerminal(n.nodePath),
    runs: n.executionsCount,
  }));
  const pathWidth = Math.max(...formatted.map((n) => n.path.length));
  for (const n of formatted) {
    lines.push(
      tx(HISTORY_TEXTS.statsTopNodesRow, {
        path: n.path.padEnd(pathWidth),
        runs: ansi.dim(String(n.runs)),
        runsLabel: ansi.dim(n.runs === 1 ? HISTORY_TEXTS.statsRunsSingular : HISTORY_TEXTS.statsRunsPlural),
      }),
    );
  }
  lines.push('\n');
  return lines;
}

function renderStatsFailures(failures: Array<[string, number]>, ansi: IAnsi): string[] {
  const lines: string[] = [
    tx(HISTORY_TEXTS.statsSectionHeader, { title: HISTORY_TEXTS.statsSectionTitleFailures }),
  ];
  const reasonWidth = Math.max(...failures.map(([reason]) => reason.length));
  for (const [reason, count] of failures) {
    lines.push(
      tx(HISTORY_TEXTS.statsFailuresRow, {
        reason: sanitizeForTerminal(reason).padEnd(reasonWidth),
        count: ansi.red(String(count)),
      }),
    );
  }
  return lines;
}

/**
 * Strip the millisecond portion of an ISO-8601 string and swap the `T`
 * for a space so the timestamp prints as `2026-04-30 10:00:00Z`. Falls
 * through unchanged if the input doesn't match the expected shape.
 */
function trimMs(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (!m) return iso;
  return `${m[1]} ${m[2]}Z`;
}
