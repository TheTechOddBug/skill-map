/**
 * `sm findings [-n <node.path>] [--extension <ids>] [--type <slug>]
 * [--severity <s>] [--since <iso>] [--threshold <0..1>] [--stale] [--json]`
 *
 * Read `state_findings`: the judgments recorded by probabilistic finder
 * Analyzers (`origin: 'extension'`) plus the kernel-derived safety rows
 * (`origin: 'kernel'`, reserved slugs `injection-detected` /
 * `content-suspicious` / `content-malformed`). The write side is
 * `sm job submit <finder>` -> `sm job claim` -> `sm record`
 * (`spec/cli-contract.md` §Jobs); this verb is the read surface.
 *
 * Filters (orthogonal): `-n` by node path; `--extension` comma-separated
 * qualified or bare extension ids (same matching grammar as
 * `sm check --analyzers`); `--type` by finding slug; `--severity` MINIMUM
 * severity (`warn` keeps warn + error); `--since` ISO date on
 * `generated_at`; `--threshold` minimum confidence. Stale rows (body hash
 * drifted since generation, or the node gone from the scan) are EXCLUDED
 * by default; `--stale` includes them marked `(stale)` in human mode and
 * `stale: true` in JSON.
 *
 * `--json` emits `{ ok, kind: 'findings', findings[], total }`, each
 * entry mirroring the `state_findings` row (camelCase) plus the derived
 * `stale` boolean.
 *
 * Exit codes (per `spec/cli-contract.md`):
 *   0  always when the read succeeds: findings are probabilistic,
 *      advisory by construction, and never drive exit codes (the
 *      deterministic sibling with exit-code semantics is `sm check`).
 *   2  bad flag value (unknown severity, unparseable date / threshold).
 *   5  DB file missing, run `sm scan` first.
 */

import { Command, Option } from 'clipanion';

import type { IFindingRecord, IFindingsListFilter } from '../../kernel/types/storage.js';
import type { Severity } from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { FINDINGS_CLI_TEXTS as T } from '../i18n/findings.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { confirm } from '../util/confirm.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';

export class FindingsCommand extends SmCommand {
  static override paths = [['findings']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Print stored probabilistic findings (finder judgments + kernel safety rows).',
    details: `
      Reads state_findings: one row per judgment a probabilistic finder
      Analyzer recorded via the job loop (sm job submit -> sm job claim ->
      sm record), plus the kernel-derived safety rows (injection-detected /
      content-suspicious / content-malformed).

      Stale rows (the node body changed since the judgment, or the node
      left the scan) are excluded by default; --stale includes them,
      marked. --severity is a MINIMUM (warn keeps warn + error);
      --threshold is a minimum confidence; --extension accepts qualified
      or bare ids like sm check --analyzers.

      Findings are advisory by construction and never gate exit codes;
      the verb exits 0 regardless of content. Run sm scan first to
      populate the DB (missing DB exits 5).
    `,
    examples: [
      ['Print every current finding', '$0 findings'],
      ['Restrict to one node', '$0 findings -n .claude/skills/foo/SKILL.md'],
      ['Only one finder, high confidence', '$0 findings --extension my-plugin/quality-check --threshold 0.8'],
      ['Include stale judgments', '$0 findings --stale'],
      ['Machine-readable envelope', '$0 findings --json'],
    ],
  });

  node = Option.String('-n,--node', {
    required: false,
    description: 'Restrict to findings whose node path equals the given path.',
  });
  extension = Option.String('--extension', {
    required: false,
    description: 'Comma-separated extension ids (qualified or bare). Restrict the read.',
  });
  type = Option.String('--type', {
    required: false,
    description: 'Restrict to findings with the given type slug.',
  });
  severity = Option.String('--severity', {
    required: false,
    description: 'Minimum severity: info, warn, or error.',
  });
  since = Option.String('--since', {
    required: false,
    description: 'Keep findings generated at or after the given ISO date.',
  });
  threshold = Option.String('--threshold', {
    required: false,
    description: 'Minimum confidence, 0..1.',
  });
  stale = Option.Boolean('--stale', false, {
    description: 'Include stale findings (body changed since generation), marked (stale).',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    const filter = this.buildFilterOrExit();
    if (typeof filter === 'number') return filter;

    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        // Read verb: advise on drift, never refuse.
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        const findings = await adapter.findings.list(filter);
        if (this.json) {
          this.printer!.data(
            JSON.stringify({ ok: true, kind: 'findings', findings, total: findings.length }) +
              '\n',
          );
          return ExitCode.Ok;
        }
        const ansi = this.ansiFor('stdout');
        if (findings.length === 0) {
          this.printer!.data(tx(T.noFindings, { glyph: ansi.green('✓') }));
          return ExitCode.Ok;
        }
        this.printer!.data(renderHuman(findings, ansi));
        // Advisory by construction: content never drives the exit code.
        return ExitCode.Ok;
      },
    );
  }

  /**
   * Parse + validate the filter flags into the storage filter shape.
   * Every rejection is a §3.1b two-line block on stderr with exit 2.
   */
  // CLI multi-flag handling (context/lint.md category 1): each
  // `if (this.flag)` leg is one cyclomatic branch and splitting per
  // branch would scatter the validation away from the flag it gates.
  // eslint-disable-next-line complexity
  private buildFilterOrExit(): IFindingsListFilter | TExitCode {
    const filter: IFindingsListFilter = {};
    if (this.node !== undefined) filter.nodeId = this.node;
    if (this.type !== undefined) filter.type = this.type;
    if (this.stale) filter.includeStale = true;

    const extensionIds = parseIdListFlag(this.extension);
    if (extensionIds !== undefined) filter.extensionIds = extensionIds;

    if (this.severity !== undefined) {
      if (this.severity !== 'info' && this.severity !== 'warn' && this.severity !== 'error') {
        return this.failFlag(T.errBadSeverity, T.errBadSeverityHint, this.severity);
      }
      filter.minSeverity = this.severity;
    }
    if (this.since !== undefined) {
      const parsed = Date.parse(this.since);
      if (Number.isNaN(parsed)) {
        return this.failFlag(T.errBadSince, T.errBadSinceHint, this.since);
      }
      filter.sinceMs = parsed;
    }
    if (this.threshold !== undefined) {
      const parsed = Number(this.threshold);
      if (this.threshold.trim() === '' || Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
        return this.failFlag(T.errBadThreshold, T.errBadThresholdHint, this.threshold);
      }
      filter.minConfidence = parsed;
    }
    return filter;
  }

  /** Render one §3.1b flag rejection (glyph + headline + dim hint), exit 2. */
  private failFlag(template: string, hint: string, value: string): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(template, { glyph: ansi.red('✕'), value, hint: ansi.dim(hint) }),
    );
    return ExitCode.Error;
  }
}

/**
 * `sm findings prune [--dry-run] [--yes] [--json]`
 *
 * Delete STALE `state_findings` rows (body hash drifted since generation,
 * or the node no longer exists in `scan_nodes`); fresh rows are never
 * touched (`spec/cli-contract.md` §sm findings prune). The read-time
 * mitigation (`sm findings` hides stale rows by default) makes this pure
 * hygiene: the only other eraser is a fresh record for the pair.
 *
 * Destructive-verb convention (mirror of `sm sidecar prune`): without
 * `--dry-run` prompts for interactive confirmation reporting the row
 * count; `--yes` bypasses for non-interactive callers; `--dry-run`
 * reports without deleting and never prompts. `--json` envelope:
 * `{ deleted, wouldDelete, elapsedMs }`. Absent DB -> exit 5.
 */
export class FindingsPruneCommand extends SmCommand {
  static override paths = [['findings', 'prune']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Delete stale findings (body changed since the judgment, or the node left the scan).',
    details: `
      Deletes ONLY the stale state_findings rows: those whose
      body_hash_at_generation no longer matches the node's live body
      hash, or whose node is gone from scan_nodes entirely. Fresh
      findings are never touched.

      Without --dry-run the verb prompts for interactive confirmation
      reporting the row count (per the destructive-verb convention);
      --yes bypasses the prompt for non-interactive callers; --dry-run
      reports what would be deleted without touching anything and never
      prompts.
    `,
    examples: [
      ['Count what would be pruned', '$0 findings prune --dry-run'],
      ['Delete stale findings (interactive)', '$0 findings prune'],
      ['Delete stale findings (non-interactive)', '$0 findings prune --yes'],
    ],
  });

  dryRun = Option.Boolean('-n,--dry-run', false);
  yes = Option.Boolean('--yes,--force', false, {
    description:
      'Skip the interactive confirmation prompt. Required for non-interactive callers (CI, scripts).',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const stale = await adapter.findings.countStale();
      if (stale === 0) return this.reportNone();
      if (this.dryRun) return this.reportDryRun(stale);
      // Destructive-verb convention (spec/cli-contract.md §Dry-run rule):
      // without --dry-run, confirm interactively unless --yes was passed,
      // reporting the row count the delete is about to erase.
      if (!this.yes && !(await this.confirmPrune(stale))) {
        this.printer!.info(tx(T.pruneAborted, { glyph: this.ansiFor('stderr').cyan('ℹ') }));
        return ExitCode.Ok;
      }
      return this.reportDeleted(await adapter.findings.pruneStale());
    });
  }

  /** Empty result: nothing stale, the friendly line (or zero envelope). */
  private reportNone(): TExitCode {
    if (this.json) {
      this.emitEnvelope({ deleted: 0, wouldDelete: 0 });
    } else {
      this.printer!.data(tx(T.pruneNone, { glyph: this.ansiFor('stdout').green('✓') }));
    }
    return ExitCode.Ok;
  }

  /** `--dry-run`: report the would-delete count, touch nothing, no prompt. */
  private reportDryRun(stale: number): TExitCode {
    if (this.json) {
      this.emitEnvelope({ deleted: 0, wouldDelete: stale });
    } else {
      const ansi = this.ansiFor('stdout');
      this.printer!.data(
        tx(T.pruneSummaryDryRun, {
          glyph: ansi.yellow('⋯'),
          wouldDelete: stale,
          plural: stale === 1 ? '' : 's',
          dryTag: ansi.dim(T.pruneDryRunTag),
        }),
      );
    }
    return ExitCode.Ok;
  }

  /** Interactive confirmation naming the row count about to be erased. */
  private async confirmPrune(stale: number): Promise<boolean> {
    return confirm(
      tx(T.pruneConfirm, { count: stale, plural: stale === 1 ? '' : 's' }),
      { stdin: this.context.stdin, stderr: this.context.stderr },
    );
  }

  /** Post-delete summary (or the deleted-count envelope). */
  private reportDeleted(deleted: number): TExitCode {
    if (this.json) {
      this.emitEnvelope({ deleted, wouldDelete: 0 });
    } else {
      this.printer!.data(
        tx(T.pruneSummary, {
          glyph: this.ansiFor('stdout').green('✓'),
          deleted,
          plural: deleted === 1 ? '' : 's',
        }),
      );
    }
    return ExitCode.Ok;
  }

  /** `{ deleted, wouldDelete, elapsedMs }` per the cli-contract row. */
  private emitEnvelope(counts: { deleted: number; wouldDelete: number }): void {
    this.printer!.data(
      JSON.stringify({ ...counts, elapsedMs: this.elapsed!.ms() }) + '\n',
    );
  }
}

/**
 * Parse a comma-separated id-list flag. Returns `undefined` when the
 * flag is absent or holds only empty tokens (no filter); empty entries
 * are dropped so a trailing comma does not change the matched set
 * (mirror of `sm check`'s `--analyzers` parsing).
 */
function parseIdListFlag(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.length === 0 ? undefined : ids;
}

/**
 * Human renderer, the `sm check` visual language applied to findings:
 *
 *   sm findings: 2 warnings · 1 info
 *
 *     notes/guide.md
 *       ⚠  plug/finder  contradiction  Message text  (85%)
 *          Longer evidence detail, dim, when present.
 *
 *   Tip: `sm show <path>` shows a node's findings in context; ...
 *
 * Rows group by node path; extension-id and type columns pad to the
 * longest across the rendered set so messages align between sections.
 * Every DB-sourced string is sanitised once at the row-shape boundary
 * (defence in depth against a hostile finder's stored message repainting
 * the terminal).
 */
function renderHuman(findings: readonly IFindingRecord[], ansi: IAnsi): string {
  const rows = findings.map(toRenderRow);

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const r of rows) counts[r.severity]++;

  const byNode = new Map<string, IRenderRow[]>();
  for (const r of rows) {
    const bucket = byNode.get(r.node);
    if (bucket) bucket.push(r);
    else byNode.set(r.node, [r]);
  }

  const widths: IColumnWidths = {
    extension: Math.max(...rows.map((r) => r.extensionId.length)),
    type: Math.max(...rows.map((r) => r.type.length)),
  };

  const header = tx(T.summaryHeader, { summary: formatSummary(counts, ansi) });
  const body = [...byNode]
    .map(([node, bucket]) => renderNodeSection(node, bucket, widths, ansi))
    .join('');
  // Each section ends in a blank-line separator; drop the final one so
  // exactly one blank line sits between the last section and the tip
  // (the tip template opens with its own `\n`, mirror of `sm check`).
  return header + body.replace(/\n$/, '') + T.tipLine;
}

/** Row shape sanitised once at the boundary; the layout never re-gates. */
interface IRenderRow {
  severity: Severity;
  node: string;
  extensionId: string;
  type: string;
  message: string;
  detail: string | null;
  confidence: number;
  /** Agent-self-reported model, sanitized (agent-supplied); null when undeclared. */
  model: string | null;
  stale: boolean;
}

interface IColumnWidths {
  extension: number;
  type: number;
}

function toRenderRow(f: IFindingRecord): IRenderRow {
  return {
    severity: f.severity,
    node: sanitizeForTerminal(f.nodeId),
    extensionId: sanitizeForTerminal(f.extensionId),
    type: sanitizeForTerminal(f.type),
    message: flattenMessage(sanitizeForTerminal(f.message)),
    detail: f.detail === null ? null : flattenMessage(sanitizeForTerminal(f.detail)),
    confidence: f.confidence,
    model: f.model === null ? null : flattenMessage(sanitizeForTerminal(f.model)),
    stale: f.stale,
  };
}

/** One node heading plus its finding rows (and their detail lines). */
function renderNodeSection(
  node: string,
  bucket: readonly IRenderRow[],
  widths: IColumnWidths,
  ansi: IAnsi,
): string {
  const lines: string[] = [tx(T.fileSection, { file: node })];
  for (const row of bucket) {
    lines.push(
      tx(T.findingRow, {
        glyph: severityGlyph(row.severity, ansi),
        extensionId: ansi.dim(row.extensionId.padEnd(widths.extension)),
        type: row.type.padEnd(widths.type),
        message: row.message,
        confidence: ansi.dim(renderConfidence(row)),
        staleTag: row.stale ? ansi.yellow(T.staleTag) : '',
      }),
    );
    if (row.detail !== null && row.detail.length > 0) {
      lines.push(tx(T.detailLine, { detail: ansi.dim(row.detail) }));
    }
  }
  lines.push('\n');
  return lines.join('');
}

/**
 * Header summary `N errors · M warnings · K info`, zero-count categories
 * dropped, each fragment colored independently (mirror of `sm check`).
 */
function formatSummary(counts: Record<Severity, number>, ansi: IAnsi): string {
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(
      ansi.red(
        tx(T.summaryErrorFragment, { count: counts.error, plural: counts.error === 1 ? '' : 's' }),
      ),
    );
  }
  if (counts.warn > 0) {
    parts.push(
      ansi.yellow(
        tx(T.summaryWarningFragment, { count: counts.warn, plural: counts.warn === 1 ? '' : 's' }),
      ),
    );
  }
  if (counts.info > 0) {
    parts.push(ansi.cyan(tx(T.summaryInfoFragment, { count: counts.info })));
  }
  return parts.join(' · ');
}

/** Severity glyph + color: ✕ red / ⚠ yellow / ℹ cyan. Mirrors `sm check`. */
function severityGlyph(severity: Severity, ansi: IAnsi): string {
  switch (severity) {
    case 'error':
      return ansi.red('✕');
    case 'warn':
      return ansi.yellow('⚠');
    case 'info':
      return ansi.cyan('ℹ');
  }
}

/**
 * Confidence cell: bare percentage, or percentage + the agent's
 * self-reported model id when one was declared at record time
 * (`(95% · claude-opus-4-8)`).
 */
function renderConfidence(row: Pick<IRenderRow, 'confidence' | 'model'>): string {
  const percent = Math.round(row.confidence * 100);
  if (row.model === null) return tx(T.confidenceValue, { percent });
  return tx(T.confidenceWithModelValue, { percent, model: row.model });
}

/** Flatten embedded newlines so a row stays one aligned line. */
function flattenMessage(message: string): string {
  return message.replace(/\n+/g, ' ');
}
