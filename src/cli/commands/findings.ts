/**
 * `sm findings [-n <node.path>] [--extension <ids>] [--type <slug>]
 * [--severity <s>] [--since <iso>] [--threshold <0..1>] [--stale]
 * [--fixed] [--json]`
 *
 * Read `state_findings`: the judgments recorded by probabilistic finder
 * Analyzers (`origin: 'extension'`) plus the kernel-derived safety rows
 * (`origin: 'kernel'`, reserved slugs `injection-detected` /
 * `content-suspicious` / `content-malformed`). The write side is
 * `sm jobs submit <finder>` -> `sm jobs claim` -> `sm record`
 * (`spec/cli-contract.md` §Jobs); this verb is the read surface.
 *
 * Filters (orthogonal): `-n` by node path; `--extension` comma-separated
 * qualified or bare extension ids (same matching grammar as
 * `sm check --analyzers`); `--type` by finding slug; `--severity` MINIMUM
 * severity (`warn` keeps warn + error); `--since` ISO date on
 * `generated_at`; `--threshold` minimum confidence.
 *
 * The default view shows what needs attention: open rows,
 * `human-decision` rows, AND stale rows (body hash drifted since
 * generation, or the node gone from the scan), the latter riding inline
 * marked `(stale)` per row (user call 2026-07-20: staleness is a per-row
 * annotation, not a hidden bucket). It hides `fixed` rows
 * (`resolution = 'fixed'`, already handled) and dismissed rows. A row
 * that is BOTH fixed and stale counts as fixed (state precedence).
 *
 * The bucket flags are FILTERS, not additive reveals: `--fixed` shows ONLY
 * the fixed bucket (marked with the deciding actor), `--stale` narrows to
 * ONLY the stale rows, together their union. With either present the
 * default-view rows are omitted and the excluded-count reporting does NOT
 * apply (it is a default-view honesty device, exactly like `--type` is
 * the operator's own narrowing). An empty bucket-filter result reads the
 * same no-match line as an empty `--type` view, never the clean verdict,
 * never the `No fresh findings` breakdown.
 *
 * In the DEFAULT view, excluded rows are never silently swallowed:
 * whatever it hides is reported under the SAME filters, as a human footer
 * / empty-state line and as `dismissedExcluded` + `fixedExcluded` in
 * JSON. An empty result with hidden rows reads `No fresh findings` plus
 * the hidden breakdown, never a bare `No findings`, which would assert a
 * clean node while judgments sit hidden (observed live: the operator read
 * it as his data having been deleted). Zero rows at all is the only
 * clean-verdict output. A `fixed` row is a STATE, not a verdict:
 * re-running the finder is how the operator confirms it (clean deletes
 * it, still-present reopens it). A `fixed` row also carries
 * `resolutionActor` (`human` / `fixer`), rendered under the checkmark.
 *
 * `--json` emits `{ ok, kind: 'findings', findings[], total,
 * dismissedExcluded, fixedExcluded }`, each entry mirroring the
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

import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import type {
  IFindingRecord,
  IFindingsListFilter,
  TFindingResolution,
  TResolutionActor,
} from '../../kernel/types/storage.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { Severity } from '../../kernel/types.js';
import {
  bucketFilterActive,
  countDismissedHidden,
  countFixedHidden,
  isFindingSuppressed,
  partitionFindingsView,
  type ISuppressionEntry,
  type TFindingSuppressedTest,
} from '../../kernel/jobs/index.js';
import {
  buildSuppressionEntry,
  existingSuppressions,
  mergeSuppression,
  normalizeSuppressionType,
  readSidecarFor,
  sidecarPathFor,
} from '../../kernel/sidecar/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import { matchesQualifiedExtensionFilter } from '../../kernel/util/analyzer-filter.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import {
  EConsentRequiredError,
  ensureSidecarWritesAllowed,
} from '../../core/config/sidecar-consent.js';
import { FINDINGS_CLI_TEXTS as T } from '../i18n/findings.texts.js';
import { CONSENT_TEXTS } from '../i18n/consent.texts.js';
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
      Analyzer recorded via the job loop (sm jobs submit -> sm jobs claim ->
      sm record), plus the kernel-derived safety rows (injection-detected /
      content-suspicious / content-malformed).

      The default view shows what needs attention: open rows,
      human-decision rows, and stale rows (the node body changed since the
      judgment, or the node left the scan), stale ones riding inline
      marked (stale). It hides fixed rows (already handled) and dismissed
      rows. The bucket flags are FILTERS, not additive reveals: --fixed
      shows ONLY the fixed bucket (marked with the deciding actor),
      --stale narrows to ONLY the stale rows, together their union. With
      either present the default-view rows are omitted and the
      excluded-count reporting does not apply; an empty result reads the
      same no-match line as an empty --type view.

      In the DEFAULT view, whatever it hides is always reported: the hidden
      breakdown rides in the human output and on dismissedExcluded /
      fixedExcluded in --json, so an empty result never claims a clean node
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
      ['Only the fixed judgments', '$0 findings --fixed'],
      ['Only the stale judgments', '$0 findings --stale'],
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
    description: 'Narrow to only the stale findings (body changed since generation).',
  });
  fixed = Option.Boolean('--fixed', false, {
    description: 'Show only fixed findings (a fixer resolved them), marked with the fixer.',
  });
  dismissed = Option.Boolean('--dismissed', false, {
    description: 'Show only dismissed findings (their class matches an active suppression).',
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
        // ONE pass, every row INCLUDED (stale + fixed + dismissed),
        // partitioned via the shared kernel view helper
        // (`kernel/jobs/findings-view.ts`, the single source of the
        // default-view / bucket semantics also consumed by the BFF findings
        // route). Two reasons over a filtered list + companion counts: the
        // table is walked once for numbers this result set already holds,
        // and the hidden breakdown inherits every active filter for free
        // (-n / --type / --severity / --extension / --since / --threshold),
        // so it reports what the user actually asked about instead of a
        // table-wide total that is a lie of a different shape. The hidden
        // ROWS ride along, not just counts: the DEFAULT view's human line
        // must name the `human-decision` subset among them (the author's
        // TODO, otherwise invisible behind their own dismissal).
        const all = await adapter.findings.list({ ...filter, includeStale: true });
        // The dismissal lens: suppressions come from the write-through
        // `scan_nodes.annotations_json` mirror, ONE query for the result
        // set's nodes, zero file reads (`spec/db-schema.md`
        // §state_findings).
        const suppressions = await adapter.findings.suppressionsByPath([
          ...new Set(all.map((f) => f.nodeId)),
        ]);
        const isSuppressed: TFindingSuppressedTest = (f) =>
          isFindingSuppressed(f.extensionId, f.type, suppressions.get(f.nodeId) ?? []);
        const { shown, hidden } = partitionFindingsView(all, this.bucketFlags(), isSuppressed);
        return this.json
          ? this.emitJson(shown, hidden, isSuppressed)
          : this.emitHuman(shown, hidden, all.length === 0, isSuppressed);
      },
    );
  }

  /** The bucket flags (`--dismissed` / `--fixed` / `--stale`) in the shared shape. */
  private bucketFlags(): { dismissed: boolean; fixed: boolean; stale: boolean } {
    return { dismissed: this.dismissed, fixed: this.fixed, stale: this.stale };
  }

  /**
   * `{ ok, kind, findings, total, dismissedExcluded, fixedExcluded }`.
   * `total` keeps its meaning (the RETURNED rows). The
   * excluded counts are a DEFAULT-view honesty device: the disjoint tally
   * of what the default view held back under the same filters (precedence
   * dismissed > fixed; stale rows ride the default view inline since
   * 2026-07-20, flagged per row, so they are never held back). Both are 0
   * whenever a bucket filter is active, since an explicit bucket view
   * holds nothing back to report.
   */
  private emitJson(
    findings: readonly IFindingRecord[],
    hidden: readonly IFindingRecord[],
    isSuppressed: TFindingSuppressedTest,
  ): TExitCode {
    this.printer!.data(
      JSON.stringify({
        ok: true,
        kind: 'findings',
        findings,
        total: findings.length,
        dismissedExcluded: countDismissedHidden(hidden, isSuppressed),
        fixedExcluded: countFixedHidden(hidden, isSuppressed),
      }) + '\n',
    );
    return ExitCode.Ok;
  }

  /**
   * Human mode. A populated result renders the listing (plus, in the
   * default view, the hidden-breakdown footer); an empty one delegates to
   * `emptyLine` for one of the three empty shapes.
   */
  private emitHuman(
    findings: readonly IFindingRecord[],
    hidden: readonly IFindingRecord[],
    noRowsAtAll: boolean,
    isSuppressed: TFindingSuppressedTest,
  ): TExitCode {
    const ansi = this.ansiFor('stdout');
    if (findings.length === 0) {
      this.printer!.data(this.emptyLine(hidden, noRowsAtAll, ansi, isSuppressed));
      return ExitCode.Ok;
    }
    this.printer!.data(renderHuman(findings, hidden, ansi, isSuppressed));
    // Advisory by construction: content never drives the exit code.
    return ExitCode.Ok;
  }

  /**
   * The empty-result line, three shapes (`spec/cli-contract.md` §sm
   * findings, "excluded rows MUST be reported"):
   *
   *   - no rows at all (the query returned nothing): the clean verdict,
   *     green `✓  No findings.`. The ONLY clean-verdict output.
   *   - rows exist but a bucket filter (`--fixed` / `--stale`) narrowed the
   *     view to none: the neutral no-match line, exactly like an empty
   *     `--type` view. NEVER the clean verdict (open rows may still sit
   *     behind the filter) and NEVER the `No fresh findings` breakdown (the
   *     excluded-count device is off under an explicit bucket filter).
   *   - default view, rows held back by the default filter: neutral
   *     `ℹ  No fresh findings.` + the hidden breakdown and its remedy,
   *     naming the `human-decision` subset when one exists.
   */
  private emptyLine(
    hidden: readonly IFindingRecord[],
    noRowsAtAll: boolean,
    ansi: IAnsi,
    isSuppressed: TFindingSuppressedTest,
  ): string {
    if (noRowsAtAll) return tx(T.noFindings, { glyph: ansi.green('✓') });
    if (bucketFilterActive(this.bucketFlags())) return tx(T.noMatch, { glyph: ansi.cyan('ℹ') });
    return tx(T.noFreshFindings, {
      glyph: ansi.cyan('ℹ'),
      ...staleHiddenVars(hidden, ansi, isSuppressed),
    });
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
 * Destructive-verb convention (mirror of `sm sidecars prune`): without
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
 * `sm findings dismiss <finding.id> [--note <text>] [--yes]`
 *
 * Silence a finding the operator has judged acceptable (a false positive,
 * or an intentional pattern the finder keeps flagging). Durable, NOT a row
 * state (`spec/cli-contract.md` §sm findings dismiss): it writes a standing
 * `annotations.suppressions` entry to the node's `.sm` sidecar (through the
 * gated sidecar write channel, same consent as `sm bump`) keyed by the
 * finding's emitting extension + `type`, then refreshes the write-through
 * `scan_nodes.annotations_json` mirror. The rows are NOT deleted: the
 * suppression is a READ-TIME lens (`spec/db-schema.md` §state_findings),
 * the class hides from the default view (`--dismissed` reveals it), keeps
 * being judged and recorded on re-runs (hidden), and `sm findings
 * undismiss` restores it instantly. Suppression grain is per
 * (extension, type): findings have no stable cross-run identity, so the
 * honest durable grain is the judgment class.
 *
 * Distinct from `resolve` (marks a finding FIXED, a resolution) and `prune`
 * (clears stale rows): dismiss says "this judgment does not apply here,
 * stop showing it".
 *
 * Kernel safety-lane findings (`origin = 'kernel'`: `injection-detected` /
 * `content-suspicious` / `content-malformed`) are NOT dismissible (exit 2).
 * Exit 5 if the id does not exist; exit 2 if the id is not a positive
 * integer. `--json` emits the written suppression entry. Absent DB -> exit 5.
 */
export class FindingsDismissCommand extends SmCommand {
  static override paths = [['findings', 'dismiss']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Permanently silence a finding you judged acceptable (durable sidecar suppression).',
    details: `
      Writes a standing annotations.suppressions entry to the node's .sm
      sidecar (keyed by the finding's emitting extension + type, through the
      same consent gate as sm bump). The rows are NOT deleted: the
      suppression is a read-time lens, the judgment class hides from the
      default sm findings view (--dismissed reveals it) and stays hidden
      across finder re-runs until sm findings undismiss removes the entry,
      which restores visibility instantly.

      Suppression grain is per (extension, type): findings carry no stable
      identity across finder runs, so the honest durable grain is the
      judgment CLASS, not one occurrence.

      Distinct from sm findings resolve (marks a finding fixed) and sm
      findings prune (clears stale rows): dismiss says "this judgment does
      not apply here, stop showing it".

      Kernel safety findings (injection-detected / content-suspicious /
      content-malformed) are NOT dismissible (exit 2). Exit 5 if the id does
      not exist; exit 2 if the id is not a positive integer. --json emits
      the written suppression entry.
    `,
    examples: [
      ['Dismiss finding 42', '$0 findings dismiss 42'],
      ['Dismiss it with a reason', '$0 findings dismiss 42 --note "Intentional; the two steps are alternatives."'],
    ],
  });

  id = Option.String({ required: true });
  note = Option.String('--note', {
    required: false,
    description: 'One-line reason recorded on the suppression entry.',
  });
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm writing .sm sidecar files in this project (sets allowEditSmFiles=true on first run).',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    const id = this.parseId();
    if (id === null) return this.failBadId();

    // Write verb: refuse a drifted DB before the class delete
    // (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const finding = await adapter.findings.get(id);
      if (!finding) return this.failNotFound(id);
      // Kernel safety-lane rows are not suppressible (spec §sm findings
      // dismiss): they flag injection / malformed content, not a prose
      // judgment the operator can wave off.
      if (finding.origin === 'kernel') return this.failNotDismissible(id, finding.type);
      // The sidecar write goes through the same consent gate as sm bump;
      // wrap so a first EConsentRequiredError surfaces as a prompt / retry.
      return this.runWithConsent(() => this.dismiss(adapter, finding, ctx.cwd));
    });
  }

  /** Parse the positional id to a positive integer, or `null` when invalid. */
  private parseId(): number | null {
    const parsed = Number(this.id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  /**
   * The durable half: write the suppression entry to the node's `.sm`
   * sidecar (gated), then refresh the write-through
   * `scan_nodes.annotations_json` mirror so the read surfaces see the
   * dismissal without a scan. The rows are NOT deleted (`spec/db-schema.md`
   * §state_findings, read-time suppression lens): the class hides from the
   * default view (`--dismissed` reveals it) and `sm findings undismiss`
   * restores it instantly. `applyPatch` throws `EConsentRequiredError`
   * BEFORE any disk write, so on the first (declined) pass nothing has
   * changed and `runWithConsent` can re-run.
   */
  private async dismiss(
    adapter: StoragePort,
    finding: IFindingRecord,
    cwd: string,
  ): Promise<TExitCode> {
    const entry = this.buildSuppression(finding);
    const mdAbs = resolve(cwd, finding.nodeId);
    const sidecarAbs = sidecarPathFor(mdAbs);
    const read = readSidecarFor(mdAbs);
    const merged = mergeSuppression(existingSuppressions(read.parsed?.annotations), entry);
    const changes: Record<string, unknown> = { annotations: { suppressions: merged } };
    // A brand-new (or previously invalid) sidecar needs the required
    // `identity` block to validate; source it from the live scan node so
    // the drift baseline is honest. An EXISTING valid sidecar keeps its
    // identity untouched (dismiss is not a bump, it must not reset drift).
    if (read.parsed === null) {
      const bundle = await adapter.scans.findNode(finding.nodeId);
      if (!bundle) return this.failNodeGone(finding);
      changes['identity'] = {
        path: bundle.node.path,
        bodyHash: bundle.node.bodyHash,
        frontmatterHash: bundle.node.frontmatterHash,
      };
    }
    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    // Step 17 consent split: --yes persists the grant (its documented
    // "never asked again" contract), so it threads `always`.
    await store.applyPatch(sidecarAbs, changes, {
      confirm: this.yes,
      always: this.yes,
      cwd,
    });
    await refreshAnnotationsMirror(adapter, finding.nodeId, mdAbs);
    return this.reportDismissed(finding, entry);
  }

  /** The suppression entry to append (shared shape, `buildSuppressionEntry`). */
  private buildSuppression(finding: IFindingRecord): Record<string, unknown> {
    return buildSuppressionEntry(finding.extensionId, finding.type, this.note);
  }

  /**
   * Wrap the sidecar-writing dispatch with the `.sm` consent gate (mirror
   * of `sm bump`); shared shape with `sm findings undismiss`, see
   * `runWithSidecarConsentGate`.
   */
  private async runWithConsent(dispatch: () => Promise<TExitCode>): Promise<TExitCode> {
    return runWithSidecarConsentGate({
      verb: 'sm findings dismiss',
      yes: this.yes,
      setYes: () => {
        this.yes = true;
      },
      stdin: this.context.stdin as NodeJS.ReadStream,
      stderr: this.context.stderr as NodeJS.WriteStream,
      ansi: this.ansiFor('stderr'),
      printError: (message) => this.printer!.error(message),
      dispatch,
    });
  }

  /** Success: the suppression landed; the class hides from the default view. */
  private reportDismissed(
    finding: IFindingRecord,
    entry: Record<string, unknown>,
  ): TExitCode {
    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          ok: true,
          kind: 'suppression',
          suppression: entry,
          node: finding.nodeId,
        }) + '\n',
      );
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(T.dismissDone, {
        glyph: ansi.green('✓'),
        extension: sanitizeForTerminal(finding.extensionId),
        type: sanitizeForTerminal(finding.type),
        node: sanitizeForTerminal(finding.nodeId),
        sidecar: sanitizeForTerminal(sidecarPathFor(finding.nodeId)),
      }),
    );
    return ExitCode.Ok;
  }

  /** §3.1b rejection for a non-positive-integer id, exit 2. */
  private failBadId(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.dismissBadId, {
        glyph: ansi.red('✕'),
        value: sanitizeForTerminal(this.id),
        hint: ansi.dim(T.dismissBadIdHint),
      }),
    );
    return ExitCode.Error;
  }

  /** Exit 5: no finding carries that id. */
  private failNotFound(id: number): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.dismissNotFound, {
        glyph: ansi.red('✕'),
        id,
        hint: ansi.dim(T.dismissNotFoundHint),
      }),
    );
    return ExitCode.NotFound;
  }

  /** Exit 2: a kernel safety-lane finding is not dismissible. */
  private failNotDismissible(id: number, type: string): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.dismissNotDismissible, {
        glyph: ansi.red('✕'),
        id,
        type: sanitizeForTerminal(type),
        hint: ansi.dim(T.dismissNotDismissibleHint),
      }),
    );
    return ExitCode.Error;
  }

  /** Exit 5: the node is gone from the scan and has no sidecar to anchor. */
  private failNodeGone(finding: IFindingRecord): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.dismissNodeGone, {
        glyph: ansi.red('✕'),
        id: finding.id,
        node: sanitizeForTerminal(finding.nodeId),
        hint: ansi.dim(T.dismissNodeGoneHint),
      }),
    );
    return ExitCode.NotFound;
  }
}

/**
 * `sm findings clear (-n <node.path> | --all) [--dry-run] [--yes] [--json]`
 *
 * Wholesale delete of `state_findings` rows, FRESH included, all origins:
 * finder judgments AND kernel safety rows (`spec/cli-contract.md`
 * §sm findings clear). The clean-slate escape hatch: clear suppresses
 * NOTHING going forward, re-running a finder re-judges the node and
 * regenerates whatever still applies (which is exactly why deleting the
 * safety lane is fine here while `dismiss` refuses it: a suppression WOULD
 * silence future warnings, a delete cannot).
 *
 * Exactly ONE of `-n <node.path>` / `--all` is required (neither or both
 * is a usage error, exit 2). Destructive-verb convention (mirror of
 * `sm findings prune`): interactive confirmation reporting the row count,
 * `--yes` bypass, `--dry-run` reports without deleting and never prompts.
 * `--json` envelope: `{ deleted, wouldDelete, elapsedMs }`. Absent DB ->
 * exit 5; a target with zero rows is a friendly no-op.
 */
export class FindingsClearCommand extends SmCommand {
  static override paths = [['findings', 'clear']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Delete findings wholesale (one node or the whole project), fresh included.',
    details: `
      Deletes state_findings rows regardless of freshness or origin: finder
      judgments AND kernel safety rows go. Scope with -n <node.path> for one
      node or --all for the whole project; exactly one of the two is
      required.

      This is a reset, not a suppression: nothing is silenced going
      forward, re-running a finder re-judges the node and regenerates
      whatever still applies. To permanently silence a judgment class use
      sm findings dismiss instead; to delete only stale rows use sm
      findings prune.

      Without --dry-run the verb prompts for interactive confirmation
      reporting the row count (per the destructive-verb convention); --yes
      bypasses the prompt for non-interactive callers; --dry-run reports
      what would be deleted without touching anything and never prompts.
    `,
    examples: [
      ['Count what one node would lose', '$0 findings clear -n skills/foo.md --dry-run'],
      ['Clear one node (interactive)', '$0 findings clear -n skills/foo.md'],
      ['Clear the whole project (non-interactive)', '$0 findings clear --all --yes'],
    ],
  });

  node = Option.String('-n,--node', {
    description: 'Clear only the findings whose node path equals the given path.',
  });
  all = Option.Boolean('--all', false, {
    description: 'Clear every finding in the project.',
  });
  dryRun = Option.Boolean('--dry-run', false);
  yes = Option.Boolean('--yes,--force', false, {
    description:
      'Skip the interactive confirmation prompt. Required for non-interactive callers (CI, scripts).',
  });

  protected async run(): Promise<number> {
    // Exactly one target: bare `findings clear` deleting everything by
    // default would be a footgun, and `-n` + `--all` contradict.
    if ((this.node !== undefined) === this.all) return this.failBadTarget();
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;
    // Write verb: refuse a drifted DB before any table mutation
    // (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const count = await adapter.findings.countClearable(this.node);
      if (count === 0) return this.reportNone();
      if (this.dryRun) return this.reportDryRun(count);
      // Destructive-verb convention: confirm interactively unless --yes,
      // reporting the row count the delete is about to erase.
      if (!this.yes && !(await this.confirmClear(count))) {
        this.printer!.info(tx(T.clearAborted, { glyph: this.ansiFor('stderr').cyan('ℹ') }));
        return ExitCode.Ok;
      }
      return this.reportDeleted(await adapter.findings.clear(this.node));
    });
  }

  /** The ` on <node>` scope fragment (empty under `--all`). */
  private scope(): string {
    return this.node !== undefined
      ? tx(T.clearScopeNode, { node: sanitizeForTerminal(this.node) })
      : '';
  }

  /** Exit 2: neither or both of the two required targets. */
  private failBadTarget(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.clearBadTarget, { glyph: ansi.red('✕'), hint: ansi.dim(T.clearBadTargetHint) }),
    );
    return ExitCode.Error;
  }

  /** Zero rows in scope: nothing to clear, the friendly line. */
  private reportNone(): TExitCode {
    if (this.json) {
      this.emitEnvelope({ deleted: 0, wouldDelete: 0 });
    } else {
      this.printer!.data(
        tx(T.clearNone, { glyph: this.ansiFor('stdout').green('✓'), scope: this.scope() }),
      );
    }
    return ExitCode.Ok;
  }

  /** `--dry-run`: report the would-delete count, touch nothing, no prompt. */
  private reportDryRun(count: number): TExitCode {
    if (this.json) {
      this.emitEnvelope({ deleted: 0, wouldDelete: count });
    } else {
      const ansi = this.ansiFor('stdout');
      this.printer!.data(
        tx(T.clearSummaryDryRun, {
          glyph: ansi.yellow('⋯'),
          wouldDelete: count,
          plural: count === 1 ? '' : 's',
          scope: this.scope(),
          dryTag: ansi.dim(T.clearDryRunTag),
        }),
      );
    }
    return ExitCode.Ok;
  }

  /** Interactive confirmation naming the row count about to be erased. */
  private async confirmClear(count: number): Promise<boolean> {
    return confirm(
      tx(T.clearConfirm, { count, plural: count === 1 ? '' : 's', scope: this.scope() }),
      { stdin: this.context.stdin, stderr: this.context.stderr },
    );
  }

  /** Post-delete summary (or the deleted-count envelope). */
  private reportDeleted(deleted: number): TExitCode {
    if (this.json) {
      this.emitEnvelope({ deleted, wouldDelete: 0 });
    } else {
      this.printer!.data(
        tx(T.clearSummary, {
          glyph: this.ansiFor('stdout').green('✓'),
          deleted,
          plural: deleted === 1 ? '' : 's',
          scope: this.scope(),
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
 * `sm findings suppressions [-n <node.path>] [--json]`
 *
 * READ verb, the visibility half of the dismiss escape hatch
 * (`spec/cli-contract.md` §sm findings suppressions): lists every ACTIVE
 * suppression so a silenced judgment class is never invisible state.
 * Reads the write-through `scan_nodes.annotations_json` mirror (the `.sm`
 * sidecar stays the source of truth; dismiss / undismiss keep the column
 * fresh, a hand-edited `.sm` reconciles at the next scan), ONE query and
 * zero file reads. `-n` narrows to one node. Always exit 0.
 */
export class FindingsSuppressionsCommand extends SmCommand {
  static override paths = [['findings', 'suppressions']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'List active finding suppressions (judgment classes silenced by dismiss).',
    details: `
      Lists every standing annotations.suppressions entry across the
      scanned nodes: which (extension, type) judgment classes sm findings
      dismiss silenced, where, and why (the recorded note). Without this
      view a dismissed class is invisible state.

      -n restricts to one node path. Remove an entry with sm findings
      undismiss; the class's stored findings show again instantly.
    `,
    examples: [
      ['List every active suppression', '$0 findings suppressions'],
      ['One node', '$0 findings suppressions -n skills/foo.md'],
    ],
  });

  node = Option.String('-n,--node', {
    description: 'Restrict to the suppressions of this node path.',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;
    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        // The write-through `scan_nodes.annotations_json` mirror: ONE
        // query, zero file reads (dismiss / undismiss keep it fresh; a
        // hand-edited `.sm` reconciles at the next scan).
        const byPath = await adapter.findings.suppressionsByPath(
          this.node !== undefined ? [this.node] : undefined,
        );
        const rows = [...byPath]
          .flatMap(([node, entries]) => entries.map((entry) => ({ node, ...entry })))
          .sort(
            (a, b) =>
              a.node.localeCompare(b.node) ||
              a.extension.localeCompare(b.extension) ||
              (a.type ?? '').localeCompare(b.type ?? ''),
          );
        return this.report(rows);
      },
    );
  }

  private report(rows: Array<{ node: string } & ISuppressionEntry>): TExitCode {
    if (this.json) {
      this.printer!.data(
        JSON.stringify({ ok: true, kind: 'suppressions', suppressions: rows }) + '\n',
      );
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
    if (rows.length === 0) {
      this.printer!.data(tx(T.suppressionsNone, { glyph: ansi.green('✓') }));
      return ExitCode.Ok;
    }
    let out = tx(T.suppressionsHeader, { count: rows.length });
    for (const row of rows) {
      out += tx(T.suppressionsRow, {
        node: sanitizeForTerminal(row.node),
        extension: sanitizeForTerminal(row.extension),
        type: row.type !== undefined ? sanitizeForTerminal(row.type) : T.suppressionsAllTypes,
        noteSuffix:
          row.note !== undefined
            ? ansi.dim(tx(T.suppressionsNoteSuffix, { note: sanitizeForTerminal(row.note) }))
            : '',
      });
    }
    out += ansi.dim(T.suppressionsTip);
    this.printer!.data(out);
    return ExitCode.Ok;
  }
}

/**
 * `sm findings undismiss -n <node.path> --extension <id> [--type <slug>]
 * [--yes] [--json]`
 *
 * Remove ONE suppression entry from the node's `.sm` sidecar, the inverse
 * of `sm findings dismiss` (`spec/cli-contract.md` §sm findings
 * undismiss). Identity is exact, mirroring the dismiss merge rules:
 * `--extension` (qualified or bare) plus `--type` targets that typed
 * entry; omitting `--type` targets the extension's type-less blanket
 * entry ONLY. The write rides the SAME gated sidecar channel as dismiss,
 * and refreshes the write-through `scan_nodes.annotations_json` mirror.
 *
 * Because the suppression is a read-time lens (rows were never deleted),
 * removing the entry makes the class's stored findings visible again
 * IMMEDIATELY, no re-run needed. No matching entry, or the node absent
 * from the scan, exit 5; a bare `--extension` matching more than one
 * qualified entry is ambiguous, exit 2.
 */
export class FindingsUndismissCommand extends SmCommand {
  static override paths = [['findings', 'undismiss']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Remove a suppression written by dismiss; the judgment class shows again instantly.',
    details: `
      Removes the matching annotations.suppressions entry from the node's
      .sm sidecar (through the same consent gate as sm findings dismiss).
      --extension takes the qualified or bare extension id; --type names
      the typed entry, and omitting it targets the extension's type-less
      blanket entry only.

      The suppression is a read-time lens, so the class's stored findings
      were never deleted: removing the entry makes them visible in sm
      findings immediately, no finder re-run needed. List the active
      entries with sm findings suppressions.
    `,
    examples: [
      ['Un-dismiss a typed suppression', '$0 findings undismiss -n skills/foo.md --extension core/ai-redundancy-analyzer --type redundancy'],
      ['Un-dismiss an all-types entry', '$0 findings undismiss -n skills/foo.md --extension core/ai-redundancy-analyzer'],
    ],
  });

  node = Option.String('-n,--node', {
    required: true,
    description: 'Node path whose sidecar holds the suppression.',
  });
  extension = Option.String('--extension', {
    required: true,
    description: 'Qualified or bare extension id of the suppressed class.',
  });
  type = Option.String('--type', {
    required: false,
    description: 'Type slug of the suppressed class; omit for the all-types entry.',
  });
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm writing .sm sidecar files in this project (sets allowEditSmFiles=true on first run).',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;
    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        // Scan membership anchors the sidecar path and guards typos; the
        // suppression itself lives on disk, not in the DB.
        const bundle = await adapter.scans.findNode(this.node);
        if (!bundle) return this.failNodeGone();
        return runWithSidecarConsentGate({
          verb: 'sm findings undismiss',
          yes: this.yes,
          setYes: () => {
            this.yes = true;
          },
          stdin: this.context.stdin as NodeJS.ReadStream,
          stderr: this.context.stderr as NodeJS.WriteStream,
          ansi: this.ansiFor('stderr'),
          printError: (message) => this.printer!.error(message),
          dispatch: () => this.undismiss(adapter, ctx.cwd),
        });
      },
    );
  }

  /**
   * Remove the matching entry, write the remaining list back through the
   * gated channel, and refresh the write-through
   * `scan_nodes.annotations_json` mirror: the class's rows become visible
   * again IMMEDIATELY (they were never deleted, `spec/db-schema.md`
   * §state_findings). `applyPatch` replaces arrays wholesale, so the
   * remaining list (possibly empty) is handed over in full.
   */
  private async undismiss(adapter: StoragePort, cwd: string): Promise<TExitCode> {
    const mdAbs = resolve(cwd, this.node);
    const sidecarAbs = sidecarPathFor(mdAbs);
    const existing = existingSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
    const matches = existing.filter((entry) => this.isTarget(entry));
    if (matches.length === 0) {
      // Self-heal before failing: the mirror may still claim a suppression
      // the live `.sm` no longer carries (edited or deleted outside
      // skill-map), which would keep the view hiding rows the truth no
      // longer silences. Reconciling here costs one row UPDATE and makes
      // the exit-5 honest: after it, view and file agree.
      await refreshAnnotationsMirror(adapter, this.node, mdAbs);
      return this.failNoMatch();
    }
    // A bare --extension can match two different qualified ids carrying
    // the same bare name; removing both silently would over-reach.
    if (matches.length > 1) return this.failAmbiguous(matches.length);
    const remaining = existing.filter((entry) => !this.isTarget(entry));
    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    await store.applyPatch(
      sidecarAbs,
      { annotations: { suppressions: remaining } },
      { confirm: this.yes, always: this.yes, cwd },
    );
    await refreshAnnotationsMirror(adapter, this.node, mdAbs);
    return this.reportRemoved(matches[0]!);
  }

  /** Exact-identity match: extension (qualified or bare) + type (absent = blanket). */
  private isTarget(entry: Record<string, unknown>): boolean {
    const extension = entry['extension'];
    if (typeof extension !== 'string') return false;
    if (!matchesQualifiedExtensionFilter(extension, [this.extension])) return false;
    return normalizeSuppressionType(entry['type']) === this.type;
  }

  /** The human echo for the removed entry's type cell. */
  private typeEcho(entry: Record<string, unknown>): string {
    const type = normalizeSuppressionType(entry['type']);
    return type !== undefined ? sanitizeForTerminal(type) : T.undismissAllTypes;
  }

  /** Success: the entry left the sidecar; remind that the finder re-judges. */
  private reportRemoved(entry: Record<string, unknown>): TExitCode {
    if (this.json) {
      this.printer!.data(
        JSON.stringify({ ok: true, kind: 'unsuppression', removed: entry, node: this.node }) +
          '\n',
      );
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(T.undismissDone, {
        glyph: ansi.green('✓'),
        extension: sanitizeForTerminal(String(entry['extension'])),
        type: this.typeEcho(entry),
        node: sanitizeForTerminal(this.node),
        sidecar: sanitizeForTerminal(sidecarPathFor(this.node)),
        hint: ansi.dim(T.undismissDoneHint),
      }),
    );
    return ExitCode.Ok;
  }

  /** Exit 5: no suppression entry matches the named (extension, type). */
  private failNoMatch(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.undismissNoMatch, {
        glyph: ansi.red('✕'),
        extension: sanitizeForTerminal(this.extension),
        type: this.type !== undefined ? sanitizeForTerminal(this.type) : T.undismissAllTypes,
        node: sanitizeForTerminal(this.node),
        hint: ansi.dim(T.undismissNoMatchHint),
      }),
    );
    return ExitCode.NotFound;
  }

  /** Exit 2: a bare --extension matched more than one qualified entry. */
  private failAmbiguous(count: number): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.undismissAmbiguous, {
        glyph: ansi.red('✕'),
        value: sanitizeForTerminal(this.extension),
        count,
        node: sanitizeForTerminal(this.node),
        hint: ansi.dim(T.undismissAmbiguousHint),
      }),
    );
    return ExitCode.Error;
  }

  /** Exit 5: the node is not in the current scan. */
  private failNodeGone(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.undismissNodeGone, {
        glyph: ansi.red('✕'),
        node: sanitizeForTerminal(this.node),
        hint: ansi.dim(T.undismissNodeGoneHint),
      }),
    );
    return ExitCode.NotFound;
  }
}

/**
 * Write-through half of a sidecar suppression edit (`dismiss` /
 * `undismiss`): re-read the just-written `.sm` and mirror its
 * `annotations` block into `scan_nodes.annotations_json`, so every read
 * surface (the findings view, the card counters) sees the change without
 * a scan and without per-node file reads (`spec/db-schema.md`
 * §state_findings, read-time suppression lens). The sidecar stays the
 * source of truth; a hand-edited `.sm` reconciles at the next scan.
 */
async function refreshAnnotationsMirror(
  adapter: StoragePort,
  nodeId: string,
  mdAbs: string,
): Promise<void> {
  const annotations = readSidecarFor(mdAbs).parsed?.annotations ?? null;
  await adapter.scans.refreshAnnotations(nodeId, annotations);
}

/**
 * The `.sm` consent gate shared by the sidecar-writing findings verbs
 * (`dismiss` / `undismiss`), mirror of `sm bump`: on the first
 * `EConsentRequiredError`, prompt when stdin is a TTY and `--yes` was not
 * passed; on accept flip `--yes` (via `setYes`) and re-run the dispatch
 * (the second pass passes `always: true` and persists the flag). On
 * decline or non-TTY without `--yes`, print the directed message + exit 2.
 */
async function runWithSidecarConsentGate(opts: {
  verb: string;
  yes: boolean;
  setYes: () => void;
  stdin: NodeJS.ReadStream;
  stderr: NodeJS.WriteStream;
  ansi: IAnsi;
  printError: (message: string) => void;
  dispatch: () => Promise<TExitCode>;
}): Promise<TExitCode> {
  try {
    return await opts.dispatch();
  } catch (err) {
    if (!(err instanceof EConsentRequiredError)) throw err;
    const isTTY = opts.stdin.isTTY === true;
    if (!isTTY || opts.yes) {
      opts.printError(
        tx(CONSENT_TEXTS.consentRequiredNonTty, {
          glyph: opts.ansi.red('✕'),
          verb: opts.verb,
          hint: opts.ansi.dim(CONSENT_TEXTS.consentRequiredNonTtyHint),
        }),
      );
      return ExitCode.Error;
    }
    const ok = await confirm(
      tx(CONSENT_TEXTS.consentPrompt, { glyph: opts.ansi.cyan('ℹ') }),
      { stdin: opts.stdin, stderr: opts.stderr },
      { defaultAnswer: 'yes' },
    );
    if (!ok) {
      opts.printError(
        tx(CONSENT_TEXTS.consentAborted, { glyph: opts.ansi.cyan('ℹ'), verb: opts.verb }),
      );
      return ExitCode.Error;
    }
    opts.setYes();
    return await opts.dispatch();
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
 *          ⚠  core/ai-contradiction-action proposes, your decision: <note>
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
  isSuppressed: TFindingSuppressedTest,
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
      : tx(T.staleHiddenFooter, {
          glyph: ansi.cyan('ℹ'),
          ...staleHiddenVars(hidden, ansi, isSuppressed),
        });
  return header + body.replace(/\n$/, '') + footer + T.tipLine;
}

/**
 * The breakdown + remedy vars shared by the two hidden-count shapes (the
 * empty `noFreshFindings` block and the listing footer). `breakdown` is
 * the disjoint tally `N dismissed, M fixed` (a zero count is OMITTED,
 * never `0 fixed`; precedence dismissed > fixed; stale rows stopped
 * hiding on 2026-07-20, they ride the default view flagged per row);
 * `flags` names only the reveal flag(s) that actually apply; the hint's
 * pronoun (`it` / `them`) plural-corrects on the total. The hint is
 * pre-dimmed at this boundary.
 *
 * `humanDecision` names the subset of the hidden rows awaiting the
 * author's choice (`spec/cli-contract.md` §sm findings): with stale
 * inline, only a SUPPRESSED `human-decision` row can hide, so the
 * fragment now guards the operator's TODO against their own dismissals.
 * Yellow, so the eye lands on it; the line's own glyph stays neutral
 * (it still reports what is hidden, not a failure).
 */
function staleHiddenVars(
  hidden: readonly IFindingRecord[],
  ansi: IAnsi,
  isSuppressed: TFindingSuppressedTest,
): { breakdown: string; humanDecision: string; hint: string } {
  const single = hidden.length === 1;
  const dismissed = countDismissedHidden(hidden, isSuppressed);
  const fixed = countFixedHidden(hidden, isSuppressed);
  const humanDecision = hidden.filter((f) => f.resolution === 'human-decision').length;
  const fragments: string[] = [];
  const flagNames: string[] = [];
  if (dismissed > 0) {
    fragments.push(tx(T.hiddenDismissedFragment, { count: dismissed }));
    flagNames.push(T.hiddenFlagDismissed);
  }
  if (fixed > 0) {
    fragments.push(tx(T.hiddenFixedFragment, { count: fixed }));
    flagNames.push(T.hiddenFlagFixed);
  }
  return {
    breakdown: fragments.join(T.hiddenBreakdownJoiner),
    humanDecision:
      humanDecision === 0
        ? ''
        : ansi.yellow(tx(T.staleHiddenHumanDecisionFragment, { count: humanDecision })),
    hint: ansi.dim(
      tx(T.staleHiddenHint, {
        pronoun: single ? 'it' : 'them',
        flags: flagNames.join(T.hiddenFlagsJoiner),
      }),
    ),
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
