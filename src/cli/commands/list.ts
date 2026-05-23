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
 *   5  DB file missing, run `sm scan` first
 */

import { Command, Option } from 'clipanion';

import type { StoragePort } from '../../kernel/ports/storage.js';
import type { Node } from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { LIST_TEXTS } from '../i18n/list.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { parsePositiveIntegerOption } from '../util/option-validators.js';
import { SmCommand } from '../util/sm-command.js';
import { truncateTail } from '../util/text.js';
import { withSqlite } from '../util/with-sqlite.js';

// Whitelist of sortable columns. NEVER interpolate user input into SQL,
// `--sort-by` is rejected with exit 2 if it isn't in this map. Each entry
// pairs the camelCase Kysely column name (CamelCasePlugin rewrites to
// snake_case for SQL) with a sensible default direction: ASC for textual
// columns (alphabetic browsing), DESC for numeric columns (largest /
// most-active first, which is the obvious "show me what matters" intent
// when a user pairs --sort-by tokens_total with --limit N).
const SORT_BY: Record<string, { column: string; direction: 'asc' | 'desc' }> = {
  path: { column: 'path', direction: 'asc' },
  kind: { column: 'kind', direction: 'asc' },
  tokens_total: { column: 'tokensTotal', direction: 'desc' },
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

interface IValidFlags {
  ok: true;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  limitValue: number | undefined;
  tagSourceValue: 'author' | 'user' | undefined;
}

type IParsedFlags = IValidFlags | { ok: false; exit: number };

export class ListCommand extends SmCommand {
  static override paths = [['list']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Tabular listing of nodes. --json emits an array conforming to node.schema.json.',
    details: `
      Reads from the persisted scan snapshot (scan_nodes). Filters:
      --kind <k> restricts to one node kind; --issue keeps only nodes
      that touch at least one current issue; --tag <name> keeps only
      nodes carrying that tag (matches the union of frontmatter.tags
      and sidecar.annotations.tags by default; --tag-source author|user
      narrows to one side).

      --sort-by accepts: path, kind, tokens_total, links_out_count,
      links_in_count, external_refs_count. Default: path. --limit N caps
      the result; default is no limit.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['List every node', '$0 list'],
      ['List only agents', '$0 list --kind agent'],
      ['Top 5 by total tokens', '$0 list --sort-by tokens_total --limit 5'],
      ['Only nodes with issues, machine-readable', '$0 list --issue --json'],
      ['Filter by tag (author or user surfaces)', '$0 list --tag urgent'],
      ['Filter by user-only tag', '$0 list --tag wip --tag-source user'],
    ],
  });

  kind = Option.String('--kind', { required: false });
  issue = Option.Boolean('--issue', false);
  sortBy = Option.String('--sort-by', { required: false });
  limit = Option.String('--limit', { required: false });
  tag = Option.String('--tag', { required: false });
  tagSource = Option.String('--tag-source', { required: false });

  protected async run(): Promise<number> {
    const stderrAnsi = this.ansiFor('stderr');
    const flags = this.#parseFlags(stderrAnsi);
    if (!flags.ok) return flags.exit;

    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
      this.#runQuery(adapter, flags),
    );
  }

  /**
   * Centralise flag parsing + validation so the `run()` body stays
   * under the cyclomatic limit. Returns either a validated bag of
   * resolved values or a precomputed exit code (already printed
   * directed errors before returning).
   */
  // eslint-disable-next-line complexity
  #parseFlags(stderrAnsi: IAnsi): IParsedFlags {
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
        return { ok: false, exit: ExitCode.Error };
      }
      sortColumn = resolved.column;
      sortDirection = resolved.direction;
    }

    let limitValue: number | undefined;
    if (this.limit !== undefined) {
      const parsed = parsePositiveIntegerOption(this.limit, '--limit', this.context.stderr);
      if (parsed === null) return { ok: false, exit: ExitCode.Error };
      limitValue = parsed;
    }

    let tagSourceValue: 'author' | 'user' | undefined;
    if (this.tagSource !== undefined) {
      if (this.tag === undefined) {
        this.printer!.error(
          tx(LIST_TEXTS.tagSourceWithoutTag, {
            glyph: stderrAnsi.red('✕'),
            hint: stderrAnsi.dim(LIST_TEXTS.tagSourceWithoutTagHint),
          }),
        );
        return { ok: false, exit: ExitCode.Error };
      }
      if (this.tagSource !== 'author' && this.tagSource !== 'user') {
        this.printer!.error(
          tx(LIST_TEXTS.invalidTagSource, {
            glyph: stderrAnsi.red('✕'),
            value: this.tagSource,
            hint: stderrAnsi.dim(LIST_TEXTS.invalidTagSourceHint),
          }),
        );
        return { ok: false, exit: ExitCode.Error };
      }
      tagSourceValue = this.tagSource;
    }

    return { ok: true, sortColumn, sortDirection, limitValue, tagSourceValue };
  }

  /**
   * Issue the DB queries: optional `--tag` allow-list narrowing, the
   * sort+filter `findNodes` call, then human / JSON rendering. Split
   * out so `run()` reads as a thin orchestrator.
   */
  async #runQuery(adapter: StoragePort, flags: IValidFlags): Promise<number> {
    const tagAllowList = await this.#resolveTagAllowList(adapter, flags);
    if (tagAllowList === 'no-match') return this.#renderEmpty();

    const filter = this.#buildFindNodesFilter(flags);
    const allMatchingNodes = await adapter.scans.findNodes(filter);
    const nodes = tagAllowList
      ? allMatchingNodes.filter((n) => tagAllowList.has(n.path))
      : allMatchingNodes;

    const issuesByNode = await this.#countIssuesPerNode(adapter, nodes.map((n) => n.path));

    if (this.json) {
      this.printer!.data(JSON.stringify(nodes) + '\n');
      return ExitCode.Ok;
    }
    if (nodes.length === 0) return this.#renderEmpty();
    const ansi = this.ansiFor('stdout');
    this.printer!.data(renderTable(nodes, issuesByNode, ansi));
    return ExitCode.Ok;
  }

  /**
   * Resolve `--tag` (and the optional `--tag-source` filter) into a
   * path allow-list. Returns:
   *   - `null` when `--tag` was not supplied (no narrowing).
   *   - `'no-match'` when the tag matched zero nodes (caller renders
   *     the empty surface and exits).
   *   - a Set of paths otherwise.
   */
  async #resolveTagAllowList(
    adapter: StoragePort,
    flags: IValidFlags,
  ): Promise<ReadonlySet<string> | 'no-match' | null> {
    if (this.tag === undefined) return null;
    const matchingPaths = await adapter.tags.findNodes(this.tag, flags.tagSourceValue);
    if (matchingPaths.length === 0) return 'no-match';
    return new Set(matchingPaths);
  }

  /** Project the `findNodes` filter from validated flags. */
  #buildFindNodesFilter(flags: IValidFlags): {
    kind?: string;
    hasIssues?: boolean;
    sortBy: string;
    sortDirection: 'asc' | 'desc';
    limit?: number;
  } {
    const filter: {
      kind?: string;
      hasIssues?: boolean;
      sortBy: string;
      sortDirection: 'asc' | 'desc';
      limit?: number;
    } = { sortBy: flags.sortColumn, sortDirection: flags.sortDirection };
    if (this.kind !== undefined) filter.kind = this.kind;
    if (this.issue) filter.hasIssues = true;
    if (flags.limitValue !== undefined) filter.limit = flags.limitValue;
    return filter;
  }

  #renderEmpty(): number {
    if (this.json) this.printer!.data('[]\n');
    else this.printer!.data(LIST_TEXTS.noNodesFound);
    return ExitCode.Ok;
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
  tokens: number | null;
}

/**
 * Render the human-mode table:
 *
 *   PATH                   KIND       OUT  IN  EXT  ISSUES  TOKENS
 *   .claude/agents/foo.md  agent        2   0    0       0    421
 *   .claude/skills/bar.md  skill        0   1    0       1    180
 *
 * `TOKENS` is null (rendered as `-`) for nodes scanned with
 * `--no-tokens`; otherwise it's the cl100k_base count of frontmatter +
 * body, persisted in `scan_nodes.tokens_total` during `sm scan`.
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
    tokens: n.tokens?.total ?? null,
  }));

  const widths = computeWidths(rows);
  const lines: string[] = [];

  // Header, every column dim so the eye treats it as chrome.
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
  tokens: number;
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
    tokens: Math.max(headerLen(LIST_TEXTS.tableHeaderTokens), ...rows.map((r) => formatTokens(r.tokens).length)),
  };
}

function formatTokens(value: number | null): string {
  return value === null ? '-' : String(value);
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
    ansi.dim(LIST_TEXTS.tableHeaderTokens.padStart(w.tokens)),
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
    formatTokens(r.tokens).padStart(w.tokens),
  ].join('  ');
}

