/**
 * `sm check [--json] [-n <node.path>] [--analyzers <ids>]`
 *
 * Print every current issue from `scan_issues`. Equivalent to
 * `sm scan --json | jq '.issues'` but reads from the persisted snapshot,
 * so it skips the entire walk + extract + analyzer pipeline.
 *
 * Filters (orthogonal):
 *   `-n <node.path>`     restrict to issues whose nodeIds include the path.
 *   `--analyzers <ids>`      comma-separated qualified analyzer ids (e.g.
 *                         `core/schema-violation,core/reference-broken`); restrict to
 *                         issues whose `analyzerId` matches any entry. Both
 *                         qualified and short ids match, the verb compares
 *                         on suffix when the entry has no `<plugin>/` prefix.
 *
 * Deterministic-only by construction (CI-safe): probabilistic analyzers
 * never contribute to `sm check`. Their surface is `sm jobs submit` on the
 * way in and `sm findings` on the way out (`spec/cli-contract.md` §Browse,
 * the `sm check` row); the transitional `--include-prob` / `--async`
 * stubs were retired with the findings pipeline.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok, no error-severity issues (warns / infos do not fail the verb)
 *   1  one or more issues at severity `error`
 *   5  DB file missing, run `sm scan` first
 *
 * The `1` ≠ `0` boundary intentionally mirrors `sm scan`'s contract: an
 * agent / CI loop can use `sm check` as a fast pre-flight without paying
 * for a full walk.
 */

import { Command, Option } from 'clipanion';

import type { Issue, Severity } from '../../kernel/types.js';
import { matchesAnalyzerFilter } from '../../kernel/util/analyzer-filter.js';
import { CHECK_TEXTS } from '../i18n/check.texts.js';
import { validateAnalyzerFilter } from '../../core/runtime/analyzer-catalog.js';
import {
  formatKnownAnalyzerIds,
  loadAnalyzerCatalog,
} from '../util/analyzer-catalog.js';
import type { IAnsi } from '../util/ansi.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { SmCommand } from '../util/sm-command.js';
import { tx } from '../../kernel/util/tx.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';

export class CheckCommand extends SmCommand {
  static override paths = [['check']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Issues, ExitCode.Error, ExitCode.NotFound];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Print all current issues (reads from DB, faster than sm scan --json | jq).',
    details: `
      Loads every row from scan_issues. Exits 1 if any issue has
      severity \`error\`, otherwise 0. \`warn\` and \`info\` do not fail.

      Run \`sm scan\` first to populate the DB.

      Deterministic-only by construction (CI-safe): probabilistic
      analyzers never contribute here. Queue them with \`sm jobs submit\`
      and read their judgments with \`sm findings\`.
    `,
    examples: [
      ['Print every current issue', '$0 check'],
      ['Machine-readable issue list', '$0 check --json'],
      ['Restrict to a single node', '$0 check -n .claude/agents/architect.md'],
      ['Restrict to specific rules', '$0 check --analyzers core/reference-broken,core/schema-violation'],
      ['Use a non-default DB file', '$0 check --db /path/to/skill-map.db'],
    ],
  });

  node = Option.String('-n,--node', {
    required: false,
    description:
      'Restrict to issues whose nodeIds include the given path. Combines with --analyzers.',
  });
  analyzers = Option.String('--analyzers', {
    required: false,
    description:
      'Comma-separated analyzer ids (qualified or short). Restrict the issue read.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description:
      'Skip drop-in plugin discovery; only kernel built-ins participate in the --analyzers id validation. Same flag shape as `sm scan`.',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr, this.noColor);
    if (exit !== null) return exit;

    // Parse `--analyzers` once. Empty / whitespace tokens dropped.
    const analyzerFilter = parseAnalyzersFlag(this.analyzers);

    const preflight = await this.#validateAnalyzerFlag(analyzerFilter);
    if (preflight.exit !== null) return preflight.exit;

    const stderrAnsi = this.ansiFor('stderr');
    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        versionCheck: buildReadVersionCheck(this.printer!, stderrAnsi),
      },
      async (adapter) => {
        let issues = await adapter.issues.listAll();

        // Filters apply to the persisted issue list.
        if (this.node !== undefined) {
          const nodePath = this.node;
          issues = issues.filter((i) => i.nodeIds.includes(nodePath));
        }
        if (analyzerFilter !== undefined) {
          issues = issues.filter((i) => matchesAnalyzerFilter(i.analyzerId, analyzerFilter));
        }

        const ansi = this.ansiFor('stdout');
        if (this.json) {
          this.printer!.data(JSON.stringify(issues) + '\n');
        } else if (issues.length === 0) {
          this.printer!.data(
            tx(CHECK_TEXTS.noIssues, { glyph: ansi.green('✓') }),
          );
        } else {
          this.printer!.data(renderHuman(issues, ansi));
        }

        return issues.some((i) => i.severity === 'error') ? ExitCode.Issues : ExitCode.Ok;
      },
    );
  }

  /**
   * An explicit `--analyzers` list forces a load of the live Analyzer
   * catalog to validate the user-supplied ids against the registry.
   *
   * Returns `{ exit: <code> }` to short-circuit `run()` when the
   * validation rejects an unknown id (the only path that aborts before
   * the DB read). Successful runs return `{ exit: null }`.
   */
  async #validateAnalyzerFlag(
    analyzerFilter: readonly string[] | undefined,
  ): Promise<{ exit: number | null }> {
    if (analyzerFilter === undefined) return { exit: null };

    const analyzers = await loadAnalyzerCatalog({
      noPlugins: this.noPlugins,
      printer: this.printer!,
    });

    const validation = validateAnalyzerFilter(analyzerFilter, analyzers);
    if (validation !== null) {
      this.printer!.error(
        tx(CHECK_TEXTS.unknownAnalyzerIds, {
          unknown: validation.unknown.join(', '),
          known: formatKnownAnalyzerIds(validation.known),
        }),
      );
      return { exit: ExitCode.Error };
    }
    return { exit: null };
  }
}

/**
 * Parse the `--analyzers <ids>` flag into a normalised filter list. Returns
 * `undefined` when the flag is absent, the caller treats that as "no
 * filter, every rule passes". Empty entries are dropped silently so a
 * trailing comma does not change the matched set.
 */
function parseAnalyzersFlag(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (ids.length === 0) return undefined;
  return ids;
}

/**
 * Defence in depth: `analyzerId` / `message` / `nodeIds` originate from
 * plugin-authored strings persisted in the DB. Every value emitted by
 * this renderer runs through `sanitizeForTerminal` so a hostile plugin
 * cannot repaint the user's terminal via a stored issue row.
 *
 * Layout:
 *
 *   sm check, 10 warnings · 1 error
 *
 *     foo.md
 *       ✕  analyzer-id   Error message …
 *       ⚠  analyzer-id   Warning message …
 *
 *     bar.md
 *       ⚠  analyzer-id   Warning message …
 *
 *   Tip: `sm refresh <node>` to revalidate a file after fixes.
 *
 * Issues group by their primary `nodeIds[0]` (multi-node issues attach
 * to the first path; the message itself names any cross-file context).
 * Within each file, errors sort first, then warnings, then info, so
 * the most actionable rows lead each section. Analyzer ids align to the
 * widest in the rendered set so messages line up across rows.
 */
function renderHuman(issues: Issue[], ansi: IAnsi): string {
  // Sanitise once into a flat shape the layout passes can reason about
  // without re-running sanitization in every nested loop.
  const rows = issues.map((issue) => ({
    severity: issue.severity,
    analyzerId: sanitizeForTerminal(issue.analyzerId),
    message: sanitizeForTerminal(issue.message),
    primary: sanitizeForTerminal(issue.nodeIds[0] ?? '(no file)'),
  }));

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const r of rows) counts[r.severity]++;

  const byFile = groupRowsByFile(rows);

  // Width of the analyzer-id column = longest across all rendered rows.
  const analyzerWidth = Math.max(...rows.map((r) => r.analyzerId.length));

  const lines: string[] = [];
  lines.push(tx(CHECK_TEXTS.summaryHeader, { summary: formatSummary(counts, ansi) }));
  for (const [file, bucket] of byFile) {
    lines.push(tx(CHECK_TEXTS.fileSection, { file }));
    for (const row of bucket) {
      lines.push(
        tx(CHECK_TEXTS.issueRow, {
          glyph: severityGlyph(row.severity, ansi),
          analyzerId: ansi.dim(row.analyzerId.padEnd(analyzerWidth)),
          message: flattenMessage(trimRedundantPath(row.message, row.primary)),
        }),
      );
    }
    lines.push('\n');
  }
  // Drop the trailing blank-line separator between the last file and
  // the tip line so the output ends with exactly one blank.
  if (lines.length > 0 && lines[lines.length - 1] === '\n') lines.pop();
  lines.push(CHECK_TEXTS.tipLine);
  return lines.join('');
}

/**
 * Bucket sanitised rows by their primary file, then sort each bucket by
 * severity rank (errors before warns before infos). The Map preserves
 * insertion order so files surface in the order the issues stream
 * landed in (deterministic because `adapter.issues.listAll` returns a
 * stable ordering).
 */
type IRenderRow = {
  severity: Severity;
  analyzerId: string;
  message: string;
  primary: string;
};
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
function groupRowsByFile(rows: IRenderRow[]): Map<string, IRenderRow[]> {
  const byFile = new Map<string, IRenderRow[]>();
  for (const r of rows) {
    const bucket = byFile.get(r.primary);
    if (bucket) bucket.push(r);
    else byFile.set(r.primary, [r]);
  }
  for (const bucket of byFile.values()) {
    bucket.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  }
  return byFile;
}

/**
 * Format the header summary as `N errors · M warnings · K info`.
 * Categories with zero count are dropped so warn-only and info-only
 * runs stay terse. Each fragment is colored independently (red /
 * yellow / cyan).
 */
function formatSummary(counts: Record<Severity, number>, ansi: IAnsi): string {
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(
      ansi.red(
        tx(CHECK_TEXTS.summaryErrorFragment, {
          count: counts.error,
          plural: counts.error === 1 ? '' : 's',
        }),
      ),
    );
  }
  if (counts.warn > 0) {
    parts.push(
      ansi.yellow(
        tx(CHECK_TEXTS.summaryWarningFragment, {
          count: counts.warn,
          plural: counts.warn === 1 ? '' : 's',
        }),
      ),
    );
  }
  if (counts.info > 0) {
    parts.push(ansi.cyan(tx(CHECK_TEXTS.summaryInfoFragment, { count: counts.info })));
  }
  return parts.join(' · ');
}

/** Severity glyph + color: ✕ red / ⚠ yellow / ℹ cyan. */
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
 * The file path is already in the section header, so a rule's prose
 * that repeats `" from <primary>"` is trimmed. Mostly a legacy
 * safeguard: the built-in analyzers moved to the compact finding
 * grammar (subject first, no source path), so the needle rarely
 * matches anymore; kept for third-party analyzers that still embed
 * the source path in their messages.
 */
function trimRedundantPath(message: string, primary: string): string {
  if (primary === '(no file)') return message;
  const needle = ` from ${primary}`;
  if (!message.includes(needle)) return message;
  return message.replace(needle, '');
}

/**
 * Issue rows render one line each; the compact finding grammar uses a
 * `\n` between the subject and the detail (the inspector renders it as
 * a real break via `white-space: pre-line`). In the CLI table the
 * newline flattens to a single space so the row stays aligned:
 * `<subject>: <detail>`.
 */
function flattenMessage(message: string): string {
  return message.replace(/\n+/g, ' ');
}
