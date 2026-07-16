/**
 * `sm findings [-n <node.path>] [--extension <ids>] [--type <slug>]
 * [--severity <s>] [--since <iso>] [--threshold <0..1>] [--stale]
 * [--fixed] [--json]`
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
 * `generated_at`; `--threshold` minimum confidence.
 *
 * The default view shows what needs attention, hiding two DISJOINT kinds
 * of row: `fixed` rows (`resolution = 'fixed'`, already handled,
 * `--fixed` includes them) and stale rows (body hash drifted since
 * generation, or the node gone from the scan, `--stale` includes them
 * marked `(stale)`). A row that is BOTH fixed and stale counts as fixed
 * (the state takes precedence). Open rows and `human-decision` rows always
 * show: a human-decision finding is the author's pending decision.
 *
 * Excluded rows are never silently swallowed: whatever the default
 * filter hides is reported under the SAME filters, as a human footer /
 * empty-state line and as `fixedExcluded` + `staleExcluded` in JSON. An
 * empty result with hidden rows reads `No fresh findings` plus the hidden
 * breakdown, never a bare `No findings`, which would assert a clean node
 * while judgments sit hidden (observed live: the operator read it as his
 * data having been deleted). Zero rows at all is the only clean-verdict
 * output. A `fixed` row is a STATE, not a verdict: re-running the finder
 * is how the operator confirms it (clean deletes it, still-present reopens
 * it). A `fixed` row also carries `resolutionActor` (`human` / `fixer`),
 * rendered under the checkmark.
 *
 * `--json` emits `{ ok, kind: 'findings', findings[], total,
 * fixedExcluded, staleExcluded }`, each entry mirroring the
 * `state_findings` row (camelCase, incl. the `resolution*` fields) plus
 * the derived `stale` boolean. `total` is the returned row count.
 *
 * Exit codes (per `spec/cli-contract.md`):
 *   0  always when the read succeeds: findings are probabilistic,
 *      advisory by construction, and never drive exit codes (the
 *      deterministic sibling with exit-code semantics is `sm check`).
 *   2  bad flag value (unknown severity, unparseable date / threshold).
 *   5  DB file missing, run `sm scan` first.
 */

import { Command, Option } from 'clipanion';

import type {
  IFindingRecord,
  IFindingsListFilter,
  TFindingResolution,
  TResolutionActor,
} from '../../kernel/types/storage.js';
import type { Severity } from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { FINDINGS_CLI_TEXTS as T } from '../i18n/findings.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { assertNoDriftForWrite } from '../../core/sqlite/db-version-runner.js';
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

      The default view hides two disjoint kinds of row: fixed rows (already
      handled, --fixed includes them, marked with the deciding actor) and
      stale rows (the node body changed since the judgment, or the node
      left the scan, --stale includes them, marked). Open and human-decision
      rows always show. Whatever the default filter hides is always reported:
      the hidden breakdown rides in the human output and on fixedExcluded /
      staleExcluded in --json, so an empty result never claims a clean node
      while judgments sit hidden. --severity is a MINIMUM (warn keeps warn +
      error); --threshold is a minimum confidence; --extension accepts
      qualified or bare ids like sm check --analyzers.

      Findings are advisory by construction and never gate exit codes;
      the verb exits 0 regardless of content. Run sm scan first to
      populate the DB (missing DB exits 5).
    `,
    examples: [
      ['Print every current finding', '$0 findings'],
      ['Restrict to one node', '$0 findings -n .claude/skills/foo/SKILL.md'],
      ['Only one finder, high confidence', '$0 findings --extension my-plugin/quality-check --threshold 0.8'],
      ['Include fixed judgments', '$0 findings --fixed'],
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
  fixed = Option.Boolean('--fixed', false, {
    description: 'Include fixed findings (a fixer resolved them), marked with the fixer.',
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
        // ONE pass, every row INCLUDED (stale + fixed), partitioned here.
        // Two reasons over a filtered list + companion counts: the table
        // is walked once for numbers this result set already holds, and
        // the hidden breakdown inherits every active filter for free (-n /
        // --type / --severity / --extension / --since / --threshold), so
        // it reports what the user actually asked about instead of a
        // table-wide total that is a lie of a different shape.
        const all = await adapter.findings.list({ ...filter, includeStale: true });
        const shown = all.filter((f) => this.isShown(f));
        // The hidden ROWS, not just their counts: the human line must name
        // the `human-decision` subset among them (the author's TODO,
        // otherwise invisible behind the stale filter) and break the tally
        // into fixed vs stale.
        const hidden = all.filter((f) => !this.isShown(f));
        return this.json ? this.emitJson(shown, hidden) : this.emitHuman(shown, hidden);
      },
    );
  }

  /**
   * Default visibility (`spec/cli-contract.md` §sm findings). A row hides
   * for exactly one of two DISJOINT reasons, with `fixed` taking
   * precedence over `stale`:
   *
   *   - `resolution === 'fixed'`: a fixer handled it; hidden unless
   *     `--fixed`, even when the row also went stale.
   *   - not fixed but `stale`: the judged body is gone; hidden unless
   *     `--stale`. Covers open-stale AND human-decision-stale rows.
   *
   * Open rows and non-stale `human-decision` rows always show
   * (`human-decision` is the author's pending decision, never hidden by
   * state).
   */
  private isShown(f: IFindingRecord): boolean {
    if (f.resolution === 'fixed') return this.fixed;
    if (f.stale) return this.stale;
    return true;
  }

  /**
   * `{ ok, kind, findings, total, fixedExcluded, staleExcluded }`. `total`
   * keeps its meaning (the RETURNED rows); the two excluded counts are the
   * disjoint tally of what the default filters held back under the same
   * filters (a fixed+stale row counts as fixed). Each is 0 once its flag
   * (`--fixed` / `--stale`) reveals that bucket.
   */
  private emitJson(
    findings: readonly IFindingRecord[],
    hidden: readonly IFindingRecord[],
  ): TExitCode {
    this.printer!.data(
      JSON.stringify({
        ok: true,
        kind: 'findings',
        findings,
        total: findings.length,
        fixedExcluded: countFixedHidden(hidden),
        staleExcluded: countStaleHidden(hidden),
      }) + '\n',
    );
    return ExitCode.Ok;
  }

  /**
   * Human mode, three shapes (`spec/cli-contract.md` §sm findings,
   * "excluded rows MUST be reported, never silently swallowed"):
   *
   *   - no rows at all: the clean verdict, green `✓  No findings.`
   *   - zero shown, N hidden: neutral `ℹ  No fresh findings.` + the
   *     hidden breakdown (`N fixed, M stale`) and its remedy. NEVER the
   *     success glyph: nothing was verified clean, the judgments are just
   *     filtered out.
   *   - K listed, N hidden: the listing plus the same breakdown as a
   *     footer.
   *
   * Either hidden-breakdown shape names the `human-decision` subset when
   * one exists (a proposal staled by a sibling fix, see `staleHiddenVars`).
   */
  private emitHuman(findings: readonly IFindingRecord[], hidden: readonly IFindingRecord[]): TExitCode {
    const ansi = this.ansiFor('stdout');
    if (findings.length === 0) {
      this.printer!.data(
        hidden.length === 0
          ? tx(T.noFindings, { glyph: ansi.green('✓') })
          : tx(T.noFreshFindings, { glyph: ansi.cyan('ℹ'), ...staleHiddenVars(hidden, ansi) }),
      );
      return ExitCode.Ok;
    }
    this.printer!.data(renderHuman(findings, hidden, ansi));
    // Advisory by construction: content never drives the exit code.
    return ExitCode.Ok;
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
    // `includeStale` is NOT set here: the read always includes stale rows
    // and `run` partitions them, so `--stale` only decides what renders
    // and what gets counted as hidden.

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
    // Write verb: refuse a drifted DB before any table mutation
    // (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);

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
 * `sm findings resolve <finding.id> [--note <text>]`
 *
 * Mark an OPEN or `human-decision` finding `fixed` by the OPERATOR
 * ("I already handled this", `spec/cli-contract.md`). Sets
 * `resolution = 'fixed'`, `resolution_actor = 'human'`,
 * `resolution_by = NULL` (no fixer ran), the optional `--note`, and
 * `resolution_at = now`. It records a HUMAN DECISION, it does NOT verify
 * the defect is gone (only re-running the finder does); the row then hides
 * from the default `sm findings` view like any `fixed` row and stays
 * re-checkable.
 *
 * Exit codes: 5 if the id does not exist; 2 if the finding is already
 * `fixed` (re-marking is a no-op) or the id is not a positive integer;
 * 0 on success. `--json` emits `{ ok, kind: 'finding', finding }` with the
 * updated row. Absent DB -> exit 5.
 */
export class FindingsResolveCommand extends SmCommand {
  static override paths = [['findings', 'resolve']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Mark a finding fixed by you (a human decision, not a verification).',
    details: `
      Marks an open or human-decision finding fixed BY THE OPERATOR: sets
      resolution = fixed, resolution_actor = human, resolution_by = null (no
      fixer ran), the optional --note, and the stamp time. Use it when you
      already handled a finding yourself.

      It records a human decision, it does NOT verify the defect is gone;
      only re-running the finder does. The row then hides from the default
      sm findings view (like any fixed row) and stays re-checkable.

      Exit 5 if the id does not exist; exit 2 if the finding is already
      fixed, or the id is not a positive integer. --json emits the updated
      finding row.
    `,
    examples: [
      ['Mark finding 42 fixed', '$0 findings resolve 42'],
      ['Mark it fixed with a note', '$0 findings resolve 42 --note "Rewrote the section by hand."'],
    ],
  });

  id = Option.String({ required: true });
  note = Option.String('--note', {
    required: false,
    description: 'One-line reason recorded on the finding (resolution_note).',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    const id = this.parseId();
    // A number is a valid id; `null` means the value was rejected (the
    // error is already emitted). Both the id and the exit code are numbers,
    // so `null` is the unambiguous "bad value" sentinel.
    if (id === null) return this.failBadId();

    // Write verb: refuse a drifted DB before any table mutation
    // (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const outcome = await adapter.findings.resolveByHuman(
        id,
        this.note ?? null,
        Date.now(),
      );
      switch (outcome.kind) {
        case 'not-found':
          return this.failNotFound(id);
        case 'already-fixed':
          return this.failAlreadyFixed(id);
        case 'resolved':
          return this.reportResolved(id, outcome.finding);
      }
    });
  }

  /** Parse the positional id to a positive integer, or `null` when invalid. */
  private parseId(): number | null {
    const parsed = Number(this.id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  /** §3.1b rejection for a non-positive-integer id, exit 2. */
  private failBadId(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.resolveBadId, {
        glyph: ansi.red('✕'),
        value: sanitizeForTerminal(this.id),
        hint: ansi.dim(T.resolveBadIdHint),
      }),
    );
    return ExitCode.Error;
  }

  /** Success: the finding is now fixed-by-human. Row echoed under `--json`. */
  private reportResolved(id: number, finding: IFindingRecord): TExitCode {
    if (this.json) {
      this.printer!.data(JSON.stringify({ ok: true, kind: 'finding', finding }) + '\n');
    } else {
      this.printer!.data(
        tx(T.resolveDone, { glyph: this.ansiFor('stdout').green('✓'), id }),
      );
    }
    return ExitCode.Ok;
  }

  /** Exit 5: no finding carries that id. */
  private failNotFound(id: number): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.resolveNotFound, {
        glyph: ansi.red('✕'),
        id,
        hint: ansi.dim(T.resolveNotFoundHint),
      }),
    );
    return ExitCode.NotFound;
  }

  /** Exit 2: the finding is already fixed (re-marking is a no-op). */
  private failAlreadyFixed(id: number): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.resolveAlreadyFixed, {
        glyph: ansi.red('✕'),
        id,
        hint: ansi.dim(T.resolveAlreadyFixedHint),
      }),
    );
    return ExitCode.Error;
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
 *          ⚠  core/node-reconcile proposes, your decision: <note>
 *
 *   ℹ  2 fixed, 1 stale hidden (1 awaiting your decision).
 *      Pass --fixed / --stale to see them, or re-run the finders to re-check them.
 *
 *   Tip: `sm show <path>` shows a node's findings in context; ...
 *
 * Rows group by node path; extension-id and type columns pad to the
 * longest across the rendered set so messages align between sections.
 * `hidden` (empty when nothing was held back) renders as the footer above
 * the tip: the default filter never swallows rows silently.
 * Every DB-sourced string is sanitised once at the row-shape boundary
 * (defence in depth against a hostile finder's stored message repainting
 * the terminal).
 */
function renderHuman(
  findings: readonly IFindingRecord[],
  hidden: readonly IFindingRecord[],
  ansi: IAnsi,
): string {
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
    id: Math.max(...rows.map((r) => String(r.id).length)),
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
  // The hidden-count footer, when there is one, opens with its own `\n`
  // the same way and sits between them.
  const footer =
    hidden.length === 0
      ? ''
      : tx(T.staleHiddenFooter, { glyph: ansi.cyan('ℹ'), ...staleHiddenVars(hidden, ansi) });
  return header + body.replace(/\n$/, '') + footer + T.tipLine;
}

/** Hidden rows a fixer moved to `fixed` (state precedence over stale). */
function countFixedHidden(hidden: readonly IFindingRecord[]): number {
  return hidden.filter((f) => f.resolution === 'fixed').length;
}

/**
 * Hidden rows held back for staleness (everything hidden that is NOT
 * fixed): a hidden row is either fixed-hidden or stale-hidden, disjointly,
 * so the stale bucket is the complement of the fixed one.
 */
function countStaleHidden(hidden: readonly IFindingRecord[]): number {
  return hidden.length - countFixedHidden(hidden);
}

/**
 * The breakdown + remedy vars shared by the two hidden-count shapes (the
 * empty `noFreshFindings` block and the listing footer). `breakdown` is
 * the disjoint tally `N fixed, M stale` (a zero count is OMITTED, never
 * `0 fixed`); `flags` names only the reveal flag(s) that actually apply;
 * the hint's pronoun (`it` / `them`) plural-corrects on the total. The
 * hint is pre-dimmed at this boundary.
 *
 * `humanDecision` names the subset of the hidden rows awaiting the author's
 * choice (`spec/cli-contract.md` §sm findings). It takes the hidden ROWS
 * rather than their count for exactly this: a fixer's edits for sibling
 * findings stale the whole node, so the one finding it left for the author
 * to decide hides behind the stale filter (a `human-decision` row is never
 * fixed), and a bare count would report the operator's TODO as ordinary
 * staleness. Yellow, so the eye lands on it; the line's own glyph stays
 * neutral (it still reports what is hidden, not a failure).
 */
function staleHiddenVars(
  hidden: readonly IFindingRecord[],
  ansi: IAnsi,
): { breakdown: string; humanDecision: string; hint: string } {
  const single = hidden.length === 1;
  const fixed = countFixedHidden(hidden);
  const stale = countStaleHidden(hidden);
  const humanDecision = hidden.filter((f) => f.resolution === 'human-decision').length;
  const fragments: string[] = [];
  if (fixed > 0) fragments.push(tx(T.hiddenFixedFragment, { count: fixed }));
  if (stale > 0) fragments.push(tx(T.hiddenStaleFragment, { count: stale }));
  const flags =
    fixed > 0 && stale > 0
      ? T.hiddenFlagsBoth
      : fixed > 0
        ? T.hiddenFlagsFixedOnly
        : T.hiddenFlagsStaleOnly;
  return {
    breakdown: fragments.join(T.hiddenBreakdownJoiner),
    humanDecision:
      humanDecision === 0
        ? ''
        : ansi.yellow(tx(T.staleHiddenHumanDecisionFragment, { count: humanDecision })),
    hint: ansi.dim(tx(T.staleHiddenHint, { pronoun: single ? 'it' : 'them', flags })),
  };
}

/** Row shape sanitised once at the boundary; the layout never re-gates. */
interface IRenderRow {
  /** Finding id, the handle for `sm findings resolve <id>`. */
  id: number;
  severity: Severity;
  node: string;
  extensionId: string;
  type: string;
  message: string;
  detail: string | null;
  confidence: number;
  /** Agent-self-reported model, sanitized (agent-supplied); null when undeclared. */
  model: string | null;
  /** Lifecycle state; null (open) until a fixer or the operator resolves it. */
  resolution: TFindingResolution | null;
  /** Who decided a `fixed` row (`human` / `fixer`); null for `human-decision` / open. */
  resolutionActor: TResolutionActor | null;
  /** The resolution note, sanitized (agent-authored free text). */
  resolutionNote: string;
  /** The fixer's qualified extension id, sanitized; empty for a purely human resolution. */
  resolutionBy: string;
  stale: boolean;
}

interface IColumnWidths {
  /** Digit count of the widest finding id in the set (right-align column). */
  id: number;
  extension: number;
  type: number;
}

function toRenderRow(f: IFindingRecord): IRenderRow {
  return {
    id: f.id,
    severity: f.severity,
    node: sanitizeForTerminal(f.nodeId),
    extensionId: sanitizeForTerminal(f.extensionId),
    type: sanitizeForTerminal(f.type),
    message: flattenMessage(sanitizeForTerminal(f.message)),
    detail: f.detail === null ? null : flattenMessage(sanitizeForTerminal(f.detail)),
    confidence: f.confidence,
    model: f.model === null ? null : flattenMessage(sanitizeForTerminal(f.model)),
    // Both string fields are agent-supplied (the fixer authored the note;
    // the id is manifest-sourced), so they pass the same gate as the
    // finder's message: sanitized once here, never re-gated by the layout.
    resolution: f.resolution,
    resolutionActor: f.resolutionActor,
    resolutionNote: flattenMessage(sanitizeForTerminal(f.resolutionNote ?? '')),
    resolutionBy: flattenMessage(sanitizeForTerminal(f.resolutionBy ?? '')),
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
  // Content (detail / resolution) lines align under the extension column:
  // the id column (` <id>:`, visible width idWidth + 2) plus the two-space
  // gap, the glyph, and its two-space gap.
  const contentIndent = ' '.repeat(widths.id + 7);
  const lines: string[] = [tx(T.fileSection, { file: node })];
  for (const row of bucket) {
    lines.push(
      tx(T.findingRow, {
        idCol: ` ${String(row.id).padStart(widths.id)}:`,
        glyph: severityGlyph(row.severity, ansi),
        extensionId: ansi.dim(row.extensionId.padEnd(widths.extension)),
        type: row.type.padEnd(widths.type),
        message: row.message,
        confidence: ansi.dim(renderConfidence(row)),
        staleTag: row.stale ? ansi.yellow(T.staleTag) : '',
      }),
    );
    if (row.detail !== null && row.detail.length > 0) {
      lines.push(tx(T.detailLine, { indent: contentIndent, detail: ansi.dim(row.detail) }));
    }
    const resolution = renderResolution(row, contentIndent, ansi);
    if (resolution !== null) lines.push(resolution);
  }
  lines.push('\n');
  return lines.join('');
}

/**
 * The resolution line under a finding row, or `null` when nothing has
 * touched it (`spec/db-schema.md` §state_findings). Two shapes, and the
 * asymmetry between them is the whole point:
 *
 *   - `fixed`: green `✓`, DIM text. A handled state (this line only shows
 *     under `--fixed`, so the checkmark is honest here). Still NOT a
 *     verdict: `fixed` means resolved, only the finder re-judging confirms
 *     the defect is gone. The wording names the deciding actor: `by you`
 *     (a purely human `sm findings resolve`), `by <fixer> (your decision)`
 *     (a fixer ran but a user made the call), or `by <fixer>` (a fully
 *     autonomous fix).
 *   - `human-decision`: yellow `⚠`, UNDIMMED text. The author's TODO: a
 *     fixer proposed but the choice is the author's, and this note is the
 *     proposal the operator must act on.
 */
function renderResolution(row: IRenderRow, indent: string, ansi: IAnsi): string | null {
  if (row.resolution === null) return null;
  if (row.resolution === 'fixed') {
    return tx(T.resolutionLine, {
      indent,
      glyph: ansi.green('✓'),
      text: ansi.dim(fixedResolutionText(row)),
    });
  }
  // `human-decision`: the higher-value state, undimmed under a warning glyph.
  return tx(T.resolutionLine, {
    indent,
    glyph: ansi.yellow('⚠'),
    text: tx(T.resolutionHumanDecision, {
      fixer: row.resolutionBy,
      noteSuffix: resolutionNoteSuffix(row.resolutionNote),
    }),
  });
}

/**
 * The `fixed`-line text, actor-aware (`spec/db-schema.md` §state_findings):
 * a purely human resolution (`sm findings resolve`, no fixer) reads
 * `fixed by you`; a `human` decision WITH a fixer that ran reads `fixed by
 * <fixer> (your decision)`; a fully autonomous `fixer` decision reads
 * `fixed by <fixer>`. A `fixed` row missing an actor (should not happen)
 * degrades to the honest agent-attributed shape.
 */
function fixedResolutionText(row: IRenderRow): string {
  const noteSuffix = resolutionNoteSuffix(row.resolutionNote);
  if (row.resolutionActor === 'human') {
    return row.resolutionBy.length === 0
      ? tx(T.resolutionFixedByHuman, { noteSuffix })
      : tx(T.resolutionFixedByHumanWithFixer, { fixer: row.resolutionBy, noteSuffix });
  }
  return tx(T.resolutionFixedByFixer, { fixer: row.resolutionBy, noteSuffix });
}

/** The `: <note>` tail on a resolution line, or `''` when the note is empty. */
function resolutionNoteSuffix(note: string): string {
  return note.length === 0 ? '' : tx(T.resolutionNoteSuffix, { note });
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
