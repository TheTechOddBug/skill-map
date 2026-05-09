/**
 * `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N] [--json]`
 *
 * Tabular listing of nodes from the persisted snapshot. `--json` emits an
 * array conforming to `spec/schemas/node.schema.json` (one Node per row,
 * no envelope).
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok (including empty result)
 *   2  bad flag (unknown --sort-by, non-numeric --limit)
 *   5  DB file missing — run `sm scan` first
 */

import { Command, Option } from 'clipanion';

import type { StoragePort } from '../../kernel/ports/storage.js';
import type { Node } from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { LIST_TEXTS } from '../i18n/list.texts.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { parsePositiveIntegerOption } from '../util/option-validators.js';
import { SmCommand } from '../util/sm-command.js';
import { truncateTail } from '../util/text.js';
import { withSqlite } from '../util/with-sqlite.js';

// Whitelist of sortable columns. NEVER interpolate user input into SQL —
// `--sort-by` is rejected with exit 2 if it isn't in this map. Each entry
// pairs the camelCase Kysely column name (CamelCasePlugin rewrites to
// snake_case for SQL) with a sensible default direction: ASC for textual
// columns (alphabetic browsing), DESC for numeric columns (largest /
// most-active first, which is the obvious "show me what matters" intent
// when a user pairs --sort-by bytes_total with --limit N).
const SORT_BY: Record<string, { column: string; direction: 'asc' | 'desc' }> = {
  path: { column: 'path', direction: 'asc' },
  kind: { column: 'kind', direction: 'asc' },
  bytes_total: { column: 'bytesTotal', direction: 'desc' },
  links_out_count: { column: 'linksOutCount', direction: 'desc' },
  links_in_count: { column: 'linksInCount', direction: 'desc' },
  external_refs_count: { column: 'externalRefsCount', direction: 'desc' },
};

/**
 * Soft cap on the dynamic PATH column width. Real-world Markdown
 * paths sit well under this (`.claude/agents/very-long-name.md` is
 * already at 38), and capping here keeps the table from exploding
 * sideways on a single rogue path. Longer paths truncate with `…`.
 */
const PATH_COL_MAX_WIDTH = 60;

export class ListCommand extends SmCommand {
  static override paths = [['list']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Tabular listing of nodes. --json emits an array conforming to node.schema.json.',
    details: `
      Reads from the persisted scan snapshot (scan_nodes). Filters:
      --kind <k> restricts to one node kind; --issue keeps only nodes
      that touch at least one current issue.

      --sort-by accepts: path, kind, bytes_total, links_out_count,
      links_in_count, external_refs_count. Default: path. --limit N caps
      the result; default is no limit.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['List every node', '$0 list'],
      ['List only agents', '$0 list --kind agent'],
      ['Top 5 by total bytes', '$0 list --sort-by bytes_total --limit 5'],
      ['Only nodes with issues, machine-readable', '$0 list --issue --json'],
    ],
  });

  kind = Option.String('--kind', { required: false });
  issue = Option.Boolean('--issue', false);
  sortBy = Option.String('--sort-by', { required: false });
  limit = Option.String('--limit', { required: false });

  protected async run(): Promise<number> {
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const stderrAnsi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
    // --- flag validation ---------------------------------------------------
    let sortColumn = 'path';
    let sortDirection: 'asc' | 'desc' = 'asc';
    if (this.sortBy !== undefined) {
      const resolved = SORT_BY[this.sortBy];
      if (!resolved) {
        this.printer!.error(
          tx(LIST_TEXTS.invalidSortBy, {
            glyph: stderrAnsi.red('✕'),
            value: this.sortBy,
            hint: stderrAnsi.dim(
              tx(LIST_TEXTS.invalidSortByHint, { allowed: Object.keys(SORT_BY).join(', ') }),
            ),
          }),
        );
        return ExitCode.Error;
      }
      sortColumn = resolved.column;
      sortDirection = resolved.direction;
    }

    let limitValue: number | undefined;
    if (this.limit !== undefined) {
      const parsed = parsePositiveIntegerOption(this.limit, '--limit', this.context.stderr);
      if (parsed === null) return ExitCode.Error;
      limitValue = parsed;
    }

    // --- DB ----------------------------------------------------------------
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const filter: { kind?: string; hasIssues?: boolean; sortBy: string; sortDirection: 'asc' | 'desc'; limit?: number } = {
        sortBy: sortColumn,
        sortDirection,
      };
      if (this.kind !== undefined) filter.kind = this.kind;
      if (this.issue) filter.hasIssues = true;
      if (limitValue !== undefined) filter.limit = limitValue;
      const nodes = await adapter.scans.findNodes(filter);

      // Per-row issue count (used by both renderers). Keep it cheap by
      // computing once for every node returned rather than joining in SQL.
      const issuesByNode = await this.#countIssuesPerNode(adapter, nodes.map((n) => n.path));

      if (this.json) {
        this.printer!.data(JSON.stringify(nodes) + '\n');
        return ExitCode.Ok;
      }

      if (nodes.length === 0) {
        this.printer!.data(LIST_TEXTS.noNodesFound);
        return ExitCode.Ok;
      }

      const stdout = this.context.stdout as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
      this.printer!.data(renderTable(nodes, issuesByNode, ansi));
      return ExitCode.Ok;
    });
  }

  async #countIssuesPerNode(
    adapter: StoragePort,
    paths: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (paths.length === 0) return out;

    // Pull every issue and tally locally. Dataset is small (issue
    // counts are O(nodes), not O(N*M)) and avoids per-row subqueries.
    const issues = await adapter.issues.listAll();
    const wanted = new Set(paths);
    for (const issue of issues) {
      for (const id of issue.nodeIds) {
        if (!wanted.has(id)) continue;
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
    return out;
  }
}

// --- human renderer -------------------------------------------------------

interface IListRow {
  path: string;
  kind: string;
  out: number;
  in: number;
  ext: number;
  issues: number;
  bytes: number;
}

/**
 * Render the human-mode table:
 *
 *   PATH                   KIND       OUT  IN  EXT  ISSUES  BYTES
 *   .claude/agents/foo.md  agent        2   0    0       0    421
 *   .claude/skills/bar.md  skill        0   1    0       1    180
 *
 *   2 nodes
 *   Tip: `sm show <path>` for details, `sm check` for issues.
 *
 * Column widths are computed from the actual data (path + kind cap at
 * sensible upper bounds) so narrow tables don't waste screen real
 * estate. Header is dim, kind column is dim (it's metadata), issues
 * column is yellow when non-zero (the eye lands on rows worth
 * triaging) and dim when zero. Footer carries the count + a tip,
 * matching the pattern adopted by `sm plugins list`, `sm check`, and
 * `sm scan`.
 */
function renderTable(
  nodes: Node[],
  issuesByNode: Map<string, number>,
  ansi: IAnsi,
): string {
  // Defence in depth: `path` and `kind` originate from extension code
  // (Provider classification) and persisted SQLite rows. Sanitize once
  // here so hostile values can't paint ANSI / C0 bytes downstream.
  const rows: IListRow[] = nodes.map((n) => ({
    path: sanitizeForTerminal(n.path),
    kind: sanitizeForTerminal(n.kind),
    out: n.linksOutCount,
    in: n.linksInCount,
    ext: n.externalRefsCount,
    issues: issuesByNode.get(n.path) ?? 0,
    bytes: n.bytes.total,
  }));

  const widths = computeWidths(rows);
  const lines: string[] = [];

  // Header — every column dim so the eye treats it as chrome.
  lines.push(formatHeaderRow(widths, ansi));
  for (const r of rows) {
    lines.push(formatDataRow(r, widths, ansi));
  }

  // Footer: count + tip (separated by a blank line, no trailing blank).
  lines.push('');
  const noun = nodes.length === 1
    ? LIST_TEXTS.tableFooterNounSingular
    : LIST_TEXTS.tableFooterNounPlural;
  lines.push(
    tx(LIST_TEXTS.tableFooterCount, { count: nodes.length, noun }).trimEnd(),
  );
  lines.push(ansi.dim(LIST_TEXTS.tableFooterTip.trimEnd()));
  return lines.join('\n') + '\n';
}

interface IColWidths {
  path: number;
  kind: number;
  out: number;
  in: number;
  ext: number;
  issues: number;
  bytes: number;
}

function computeWidths(rows: IListRow[]): IColWidths {
  const headerLen = (s: string): number => s.length;
  return {
    path: clampMax(
      Math.max(headerLen(LIST_TEXTS.tableHeaderPath), ...rows.map((r) => r.path.length)),
      PATH_COL_MAX_WIDTH,
    ),
    kind: Math.max(headerLen(LIST_TEXTS.tableHeaderKind), ...rows.map((r) => r.kind.length)),
    out: Math.max(headerLen(LIST_TEXTS.tableHeaderOut), ...rows.map((r) => String(r.out).length)),
    in: Math.max(headerLen(LIST_TEXTS.tableHeaderIn), ...rows.map((r) => String(r.in).length)),
    ext: Math.max(headerLen(LIST_TEXTS.tableHeaderExt), ...rows.map((r) => String(r.ext).length)),
    issues: Math.max(headerLen(LIST_TEXTS.tableHeaderIssues), ...rows.map((r) => String(r.issues).length)),
    bytes: Math.max(headerLen(LIST_TEXTS.tableHeaderBytes), ...rows.map((r) => String(r.bytes).length)),
  };
}

function clampMax(value: number, max: number): number {
  return value > max ? max : value;
}

/** 2-space indent applied to every header / data row. Matches the
 * indent rhythm of `sm plugins list`, `sm check`, `sm config list`. */
const ROW_INDENT = '  ';

function formatHeaderRow(w: IColWidths, ansi: IAnsi): string {
  return ROW_INDENT + [
    ansi.dim(LIST_TEXTS.tableHeaderPath.padEnd(w.path)),
    ansi.dim(LIST_TEXTS.tableHeaderKind.padEnd(w.kind)),
    ansi.dim(LIST_TEXTS.tableHeaderOut.padStart(w.out)),
    ansi.dim(LIST_TEXTS.tableHeaderIn.padStart(w.in)),
    ansi.dim(LIST_TEXTS.tableHeaderExt.padStart(w.ext)),
    ansi.dim(LIST_TEXTS.tableHeaderIssues.padStart(w.issues)),
    ansi.dim(LIST_TEXTS.tableHeaderBytes.padStart(w.bytes)),
  ].join('  ');
}

function formatDataRow(r: IListRow, w: IColWidths, ansi: IAnsi): string {
  const issuesStr = String(r.issues);
  const issuesCol = r.issues > 0
    ? ansi.yellow(issuesStr.padStart(w.issues))
    : ansi.dim(issuesStr.padStart(w.issues));
  return ROW_INDENT + [
    truncateTail(r.path, w.path).padEnd(w.path),
    ansi.dim(r.kind.padEnd(w.kind)),
    String(r.out).padStart(w.out),
    String(r.in).padStart(w.in),
    String(r.ext).padStart(w.ext),
    issuesCol,
    String(r.bytes).padStart(w.bytes),
  ].join('  ');
}

