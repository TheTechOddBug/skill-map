/**
 * `sm export <query> --format <json|md|mermaid>`
 *
 * Filtered export over the persisted graph. Reads the DB, parses the
 * query (see `src/kernel/scan/query.ts` for the grammar), applies the
 * filter, and emits the selected subset in the requested format.
 *
 * Read-only: opens the DB, calls `loadScanResult`, never persists.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   2  bad flag / unsupported format / invalid query / unhandled error
 *   5  DB missing
 *
 * **Format support at v0.5.0**: `json` and `md` are real; `mermaid`
 * exits 2 with a clear pointer to Step 12, when the mermaid formatter
 * lands as a built-in. Wiring the format here ahead of the formatter
 * would require a synthesis layer this verb shouldn't carry.
 */

import { Command, Option } from 'clipanion';

import {
  applyExportQuery,
  ExportQueryError,
  parseExportQuery,
} from '../../kernel/scan/query.js';
import type { IExportSubset } from '../../kernel/scan/query.js';
import type { Issue, Link, Node } from '../../kernel/types.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { EXPORT_TEXTS } from '../i18n/export.texts.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';

// Built-in Claude Provider catalog rendered first, in this canonical
// order. External Providers may emit additional kinds; those are
// rendered after, sorted alphabetically (see `renderNodesByKindSection`).
const KIND_ORDER: readonly string[] = ['agent', 'command', 'skill', 'markdown'];

/**
 * `sm export` formats are a CLOSED catalog (today: `json`, `md`, with
 * `mermaid` deferred to Step 12), unlike `sm graph` whose format set
 * is OPEN to plugin-registered `IFormatter` instances. The split is
 * intentional: export emits a curated subset shape
 * (`query` / `filters` / `counts` / `nodes` / `links` / `issues`)
 * that is not part of `IFormatterContext`, so opening the catalog to
 * plugin authors would require extending the formatter contract
 * first. See `src/cli/commands/graph.ts` for the open-catalog pattern.
 */
const SUPPORTED_FORMATS = ['json', 'md'] as const;
const DEFERRED_FORMATS: Record<string, string> = {
  mermaid: EXPORT_TEXTS.formatDeferredReasonMermaid,
};

export class ExportCommand extends SmCommand {
  static override paths = [['export']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Filtered export. Query syntax is implementation-defined pre-1.0.',
    details: `
      Reads the persisted scan, applies the query filter, and emits the
      selected subset.

      Query syntax (v0.5.0): whitespace-separated key=value tokens; AND
      across keys, OR within comma-separated values. Keys: \`kind\`
      (skill / agent / command / note), \`has\` (issues), \`path\`
      (POSIX glob: \`*\` matches a single segment, \`**\` matches across
      segments).

      Pass an empty query (\`""\`), or omit the argument entirely, to
      export every node.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['Whole graph (no query)', '$0 export --format md'],
      ['Every command node', '$0 export "kind=command" --format json'],
      ['Skills + agents with issues', '$0 export "kind=skill,agent has=issues" --format md'],
      ['Files under a path glob', '$0 export "path=.claude/commands/**" --format json'],
    ],
  });

  query = Option.String({ required: false });
  format = Option.String('--format', { required: false });

  protected async run(): Promise<number> {
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');
    const format = (this.format ?? 'json').toLowerCase();
    if (DEFERRED_FORMATS[format]) {
      this.printer!.error(
        tx(EXPORT_TEXTS.formatNotImplemented, {
          glyph: errGlyph,
          format,
          reason: DEFERRED_FORMATS[format],
          hint: stderrAnsi.dim(
            tx(EXPORT_TEXTS.formatNotImplementedHint, {
              supported: SUPPORTED_FORMATS.join(', '),
            }),
          ),
        }),
      );
      return ExitCode.Error;
    }
    if (!(SUPPORTED_FORMATS as readonly string[]).includes(format)) {
      this.printer!.error(
        tx(EXPORT_TEXTS.formatUnsupported, {
          glyph: errGlyph,
          format,
          hint: stderrAnsi.dim(
            tx(EXPORT_TEXTS.formatUnsupportedHint, {
              supported: SUPPORTED_FORMATS.join(', '),
              deferred: Object.keys(DEFERRED_FORMATS).join(', '),
            }),
          ),
        }),
      );
      return ExitCode.Error;
    }

    let parsedQuery;
    try {
      // Omitted positional → empty query → match everything (per
      // `parseExportQuery`'s contract). The flag-only invocation
      // `sm export --format md` is the documented "export the whole
      // graph" shape.
      parsedQuery = parseExportQuery(this.query ?? '');
    } catch (err) {
      if (err instanceof ExportQueryError) {
        this.printer!.error(
          tx(EXPORT_TEXTS.errorPrefix, { glyph: errGlyph, message: err.message }),
        );
        return ExitCode.Error;
      }
      throw err;
    }

    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const scan = await adapter.scans.load();
      const subset = applyExportQuery(
        { nodes: scan.nodes, links: scan.links, issues: scan.issues },
        parsedQuery,
      );

      if (format === 'json') {
        this.printer!.data(JSON.stringify(serialiseSubset(subset)) + '\n');
        return ExitCode.Ok;
      }
      // format === 'md'
      this.printer!.data(renderMarkdown(subset));
      return ExitCode.Ok;
    });
  }
}

function serialiseSubset(subset: IExportSubset): {
  query: string;
  filters: { kinds?: string[]; hasIssues?: boolean; pathGlobs?: string[] };
  counts: { nodes: number; links: number; issues: number };
  nodes: Node[];
  links: Link[];
  issues: Issue[];
} {
  const filters: ReturnType<typeof serialiseSubset>['filters'] = {};
  if (subset.query.kinds) filters.kinds = subset.query.kinds;
  if (subset.query.hasIssues) filters.hasIssues = true;
  if (subset.query.pathGlobs) filters.pathGlobs = subset.query.pathGlobs;
  return {
    query: subset.query.raw,
    filters,
    counts: {
      nodes: subset.nodes.length,
      links: subset.links.length,
      issues: subset.issues.length,
    },
    nodes: subset.nodes,
    links: subset.links,
    issues: subset.issues,
  };
}

/**
 * Flat shape consumed by the markdown renderer. Every string field is
 * pre-sanitised through `sanitizeForTerminal` at the boundary
 * (`buildSanitizedRows`); the renderer interpolates the values
 * verbatim, no per-template sanitisation calls. Mirrors the boundary
 * pattern used by `sm check` (`renderHuman` in `cli/commands/check.ts`).
 *
 * `kindRaw` / `pathRaw` on `ISanitizedNode` are kept solely for the
 * grouping + sort passes inside `renderNodesByKindSection`. They are
 * the original (unsanitised) bytes used by the comparators so the
 * output order matches today's byte-for-byte. Renderers must never
 * interpolate the `*Raw` fields, they exist for ordering only.
 */
interface ISanitizedNode {
  pathRaw: string;
  path: string;
  kindRaw: string;
  kind: string;
  title: string | null;
}
interface ISanitizedLink {
  sortKey: string;
  source: string;
  kind: string;
  target: string;
  confidence: Link['confidence'];
}
interface ISanitizedIssue {
  severity: string;
  analyzerId: string;
  message: string;
}
interface ISanitizedRows {
  nodes: ISanitizedNode[];
  links: ISanitizedLink[];
  issues: ISanitizedIssue[];
  issuesPerNode: Map<string, number>;
}

function buildSanitizedRows(subset: IExportSubset): ISanitizedRows {
  const nodes: ISanitizedNode[] = subset.nodes.map((node) => {
    const title = pickTitle(node);
    return {
      pathRaw: node.path,
      path: sanitizeForTerminal(node.path),
      kindRaw: node.kind,
      kind: sanitizeForTerminal(node.kind),
      title: title === null ? null : sanitizeForTerminal(title),
    };
  });
  const links: ISanitizedLink[] = subset.links.map((link) => ({
    // Sort key uses raw bytes to preserve today's deterministic order
    // (sanitisation strips control chars; comparing on raw fields keeps
    // the output byte-identical with the legacy inline pattern).
    sortKey: `${link.source}\x00${link.kind}\x00${link.target}`,
    source: sanitizeForTerminal(link.source),
    kind: sanitizeForTerminal(link.kind),
    target: sanitizeForTerminal(link.target),
    confidence: link.confidence,
  }));
  const issues: ISanitizedIssue[] = subset.issues.map((issue) => ({
    severity: issue.severity,
    analyzerId: sanitizeForTerminal(issue.analyzerId),
    message: sanitizeForTerminal(issue.message),
  }));
  // `issuesPerNode` keys on the unsanitised `node.path` because the
  // upstream `Issue.nodeIds` payload is unsanitised too; the lookup
  // happens against `ISanitizedNode.pathRaw`.
  const issuesPerNode = countIssuesPerNode(subset.issues);
  return { nodes, links, issues, issuesPerNode };
}

function renderMarkdown(subset: IExportSubset): string {
  const rows = buildSanitizedRows(subset);
  const out: string[] = [];
  out.push(EXPORT_TEXTS.mdTitle);
  out.push('');
  out.push(
    tx(EXPORT_TEXTS.mdQueryLine, {
      query: subset.query.raw || EXPORT_TEXTS.mdQueryEmpty,
    }),
  );
  out.push(
    tx(EXPORT_TEXTS.mdCounts, {
      nodes: rows.nodes.length,
      links: rows.links.length,
      issues: rows.issues.length,
    }),
  );
  out.push('');

  out.push(...renderNodesByKindSection(rows.nodes, rows.issuesPerNode));

  if (rows.links.length > 0) {
    out.push(tx(EXPORT_TEXTS.mdLinksSectionHeader, { count: rows.links.length }));
    out.push('');
    const sorted = [...rows.links].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    for (const link of sorted) {
      out.push(
        tx(EXPORT_TEXTS.mdLinkBullet, {
          source: link.source,
          kind: link.kind,
          target: link.target,
          confidence: link.confidence,
        }),
      );
    }
    out.push('');
  }

  if (rows.issues.length > 0) {
    out.push(tx(EXPORT_TEXTS.mdIssuesSectionHeader, { count: rows.issues.length }));
    out.push('');
    for (const issue of rows.issues) {
      out.push(
        tx(EXPORT_TEXTS.mdIssueBullet, {
          severity: issue.severity,
          analyzerId: issue.analyzerId,
          message: issue.message,
        }),
      );
    }
    out.push('');
  }

  return out.join('\n');
}

/** Index issues by node path so the per-kind renderer can show issue counts. */
function countIssuesPerNode(issues: Issue[]): Map<string, number> {
  const issuesPerNode = new Map<string, number>();
  for (const issue of issues) {
    for (const id of issue.nodeIds) {
      issuesPerNode.set(id, (issuesPerNode.get(id) ?? 0) + 1);
    }
  }
  return issuesPerNode;
}

/**
 * Render the nodes-by-kind sections of the markdown export. Groups
 * nodes per kind in `KIND_ORDER`, sorts each group by path, and emits
 * `## <kind> (N)` headers followed by `- \`<path>\`, "<title>", N
 * issues` bullets.
 *
 * Consumes the sanitised row shape built upfront by
 * `buildSanitizedRows`. Grouping + sorting key on the `*Raw` fields so
 * the output order stays byte-identical to the legacy inline pattern.
 */
function renderNodesByKindSection(
  nodes: ISanitizedNode[],
  issuesPerNode: Map<string, number>,
): string[] {
  const byKind = new Map<string, ISanitizedNode[]>();
  for (const node of nodes) {
    if (!byKind.has(node.kindRaw)) byKind.set(node.kindRaw, []);
    byKind.get(node.kindRaw)!.push(node);
  }

  // Built-in Claude catalog first in canonical order; external-Provider
  // kinds appended after, alphabetically sorted, so the output is
  // deterministic across runs even with arbitrary kind sets.
  const lines: string[] = [];
  const renderedKinds = new Set<string>();
  const orderedKinds: string[] = [
    ...KIND_ORDER,
    ...[...byKind.keys()].filter((k) => !KIND_ORDER.includes(k)).sort(),
  ];
  for (const kind of orderedKinds) {
    if (renderedKinds.has(kind)) continue;
    const group = byKind.get(kind);
    if (!group || group.length === 0) continue;
    appendKindSection(lines, group, issuesPerNode);
    renderedKinds.add(kind);
  }
  return lines;
}

function appendKindSection(
  lines: string[],
  group: ISanitizedNode[],
  issuesPerNode: Map<string, number>,
): void {
  const sorted = [...group].sort((a, b) => a.pathRaw.localeCompare(b.pathRaw));
  lines.push(
    tx(EXPORT_TEXTS.mdKindSectionHeader, {
      kind: sorted[0]!.kind,
      count: sorted.length,
    }),
  );
  lines.push('');
  for (const node of sorted) lines.push(renderNodeBullet(node, issuesPerNode));
  lines.push('');
}

/** Render one node as a markdown bullet, with optional title + issue count. */
function renderNodeBullet(node: ISanitizedNode, issuesPerNode: Map<string, number>): string {
  const issueCount = issuesPerNode.get(node.pathRaw) ?? 0;
  const titleSegment = node.title !== null
    ? tx(EXPORT_TEXTS.mdNodeTitleSuffix, { title: node.title })
    : '';
  const issuesSegment = issueCount > 0
    ? tx(EXPORT_TEXTS.mdNodeIssueSuffix, {
        count: issueCount,
        label: issueCount === 1
          ? EXPORT_TEXTS.mdNodeIssueLabelSingular
          : EXPORT_TEXTS.mdNodeIssueLabelPlural,
      })
    : '';
  return tx(EXPORT_TEXTS.mdNodeBullet, {
    path: node.path,
    title: titleSegment,
    issues: issuesSegment,
  });
}

function pickTitle(node: Node): string | null {
  const name = node.frontmatter?.['name'];
  return typeof name === 'string' && name.length > 0 ? name : null;
}
