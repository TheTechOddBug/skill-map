/**
 * `sm show <node.path> [--json]`
 *
 * Detail view for a single node: weight (bytes/tokens triple-split),
 * frontmatter, links in/out, current issues. `--json` emits a detail
 * object with `node`, `linksOut`, `linksIn`, `issues`. Step 10
 * (findings) and Step 11 (summary) will add fields when their backing
 * tables ship — additive, so today's consumers stay green.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   2  bad flag
 *   5  node not found in scan_nodes (or the DB file is missing)
 */

import { Command, Option } from 'clipanion';

import type { Issue, Link, Node, Severity } from '../../kernel/types.js';
import type { INodeBundle } from '../../kernel/types/storage.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { SHOW_TEXTS } from '../i18n/show.texts.js';

/**
 * `sm show --json` payload — projection of the kernel's `INodeBundle`.
 * `Pick`'d so a future kernel-side rename (or field add to the bundle)
 * propagates here as a compile error rather than silent drift between
 * the CLI shape and the storage port. Mirrors the BFF's
 * `GET /api/nodes/:pathB64` envelope intent at the type level (audit
 * m2; the BFF wraps the bundle in an envelope, not in this exact
 * shape, but both branches now project from the same source of
 * truth).
 */
type TShowDocument = Pick<INodeBundle, 'node' | 'linksOut' | 'linksIn' | 'issues'>;

export class ShowCommand extends SmCommand {
  static override paths = [['show']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Node detail: weight, frontmatter, links, issues.',
    details: `
      Loads a single node from the persisted snapshot, plus every link
      (in and out) and every current issue touching it. Step 10
      (findings) and Step 11 (summary) will add fields when their
      backing tables ship.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['Show a single node', '$0 show .claude/agents/architect.md'],
      ['Machine-readable detail', '$0 show .claude/agents/architect.md --json'],
    ],
  });

  nodePath = Option.String({ required: true });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const bundle = await adapter.scans.findNode(this.nodePath);
      if (!bundle) {
        this.printer!.error(tx(SHOW_TEXTS.nodeNotFound, { nodePath: this.nodePath }));
        return ExitCode.NotFound;
      }

      const doc: TShowDocument = {
        node: bundle.node,
        linksOut: bundle.linksOut,
        linksIn: bundle.linksIn,
        issues: bundle.issues,
      };

      if (this.json) {
        this.printer!.data(JSON.stringify(doc) + '\n');
        return ExitCode.Ok;
      }

      const stdout = this.context.stdout as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
      this.printer!.data(renderHuman(doc, ansi));
      return ExitCode.Ok;
    });
  }
}

// --- human renderer -------------------------------------------------------

/**
 * Sectioned detail view, mirroring the visual rhythm of `sm plugins
 * show`, `sm check`, and `sm scan`:
 *
 *   ✓  <path>   <kind>   provider: <provider>
 *
 *     Title          …
 *     Description    …
 *     Bytes          N total · F frontmatter · B body
 *     Tokens         N total · F frontmatter · B body
 *     External refs  N
 *
 *     Frontmatter
 *       { … }
 *
 *     Links out (N)
 *       →  kind        confidence   endpoint
 *
 *     Links in (N)
 *       ←  kind        confidence   endpoint
 *
 *     Issues (N)
 *       ⚠  rule-id   message
 *
 * Empty `Links out` / `Links in` / `Issues` sections are dropped — the
 * "(none)" placeholder is noise when the count is zero. Frontmatter
 * and field block always render (frontmatter conveys "no metadata"
 * even when empty).
 */
function renderHuman(doc: TShowDocument, ansi: IAnsi): string {
  const { node, linksOut, linksIn, issues } = doc;
  const out: string[] = [];

  out.push(renderHeader(node, ansi));
  out.push(renderFieldBlock(node, ansi));
  out.push(renderFrontmatter(node, ansi));
  if (linksOut.length > 0) out.push(renderLinksSection('out', linksOut, ansi));
  if (linksIn.length > 0) out.push(renderLinksSection('in', linksIn, ansi));
  if (issues.length > 0) out.push(renderIssuesSection(issues, node.path, ansi));
  return out.join('');
}

function renderHeader(node: Node, ansi: IAnsi): string {
  const path = sanitizeForTerminal(node.path);
  const kind = sanitizeForTerminal(node.kind);
  const provider = sanitizeForTerminal(node.provider);
  const providerSuffix = provider === kind
    ? ''
    : tx(SHOW_TEXTS.providerSuffix, {
        label: ansi.dim(tx(SHOW_TEXTS.providerSuffixLabel, { provider })),
      });
  return tx(SHOW_TEXTS.nodeHeader, {
    glyph: ansi.green('✓'),
    path,
    kind: ansi.dim(kind),
    providerSuffix,
  });
}

interface IField {
  label: string;
  value: string;
}

/**
 * Field block: `Title` / `Description` / `Stability` / `Version` /
 * `Bytes` / `Tokens` / `External refs`. Optional fields are gated by
 * presence; the column width is computed across the rendered subset
 * so labels align.
 */
function renderFieldBlock(node: Node, ansi: IAnsi): string {
  const fields: IField[] = [];
  if (node.title) fields.push({ label: SHOW_TEXTS.fieldLabelTitle, value: sanitizeForTerminal(node.title) });
  if (node.description) fields.push({ label: SHOW_TEXTS.fieldLabelDescription, value: sanitizeForTerminal(node.description) });
  if (node.stability) fields.push({ label: SHOW_TEXTS.fieldLabelStability, value: sanitizeForTerminal(node.stability) });
  if (node.version !== null && node.version !== undefined) {
    fields.push({ label: SHOW_TEXTS.fieldLabelVersion, value: sanitizeForTerminal(String(node.version)) });
  }
  fields.push({
    label: SHOW_TEXTS.fieldLabelBytes,
    value: tx(SHOW_TEXTS.weightSplit, {
      total: node.bytes.total,
      frontmatter: node.bytes.frontmatter,
      body: node.bytes.body,
    }),
  });
  if (node.tokens) {
    fields.push({
      label: SHOW_TEXTS.fieldLabelTokens,
      value: tx(SHOW_TEXTS.weightSplit, {
        total: node.tokens.total,
        frontmatter: node.tokens.frontmatter,
        body: node.tokens.body,
      }),
    });
  }
  fields.push({ label: SHOW_TEXTS.fieldLabelExternalRefs, value: String(node.externalRefsCount) });

  const labelWidth = Math.max(...fields.map((f) => f.label.length));
  const continuationIndent = ' '.repeat(labelWidth + 2); // 2-space gap between label + value
  const lines: string[] = ['\n'];
  for (const f of fields) {
    // Drop trailing whitespace-only lines so a value ending in `\n`
    // (common in YAML block scalars) doesn't render an empty
    // continuation row right before the next field.
    const valueLines = f.value
      .split('\n')
      .map((l, i, arr) => (i === arr.length - 1 ? l.trimEnd() : l));
    while (valueLines.length > 1 && valueLines[valueLines.length - 1] === '') {
      valueLines.pop();
    }
    const firstLine = valueLines[0] ?? '';
    lines.push(
      tx(SHOW_TEXTS.fieldRow, {
        label: ansi.dim(f.label.padEnd(labelWidth)),
        value: firstLine,
      }),
    );
    for (let i = 1; i < valueLines.length; i++) {
      lines.push(
        tx(SHOW_TEXTS.fieldContinuation, {
          indent: continuationIndent,
          value: valueLines[i] ?? '',
        }),
      );
    }
  }
  return lines.join('');
}

function renderFrontmatter(node: Node, ansi: IAnsi): string {
  const json = JSON.stringify(node.frontmatter ?? {}, null, 2);
  const indented = json
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return SHOW_TEXTS.frontmatterSection + ansi.dim(indented) + '\n';
}

function renderLinksSection(
  direction: 'out' | 'in',
  links: Link[],
  ansi: IAnsi,
): string {
  const projectField: 'target' | 'source' = direction === 'out' ? 'target' : 'source';
  const arrow = direction === 'out' ? '→' : '←';
  const aggregated = aggregateLinks(links, projectField);
  const headerTpl = direction === 'out' ? SHOW_TEXTS.linksOutSection : SHOW_TEXTS.linksInSection;

  // Column widths for kind / confidence so endpoints line up.
  const kindWidth = Math.max(...aggregated.map((g) => g.kind.length));
  const confWidth = Math.max(...aggregated.map((g) => g.confidence.length));

  const lines: string[] = [tx(headerTpl, { count: links.length })];
  for (const grp of aggregated) {
    const dup = grp.rowCount > 1
      ? ansi.dim(tx(SHOW_TEXTS.linkDup, { count: grp.rowCount }))
      : '';
    lines.push(
      tx(SHOW_TEXTS.linkRow, {
        arrow: ansi.dim(arrow),
        kind: sanitizeForTerminal(grp.kind).padEnd(kindWidth),
        confidence: ansi.dim(grp.confidence.padEnd(confWidth)),
        endpoint: sanitizeForTerminal(grp.endpoint),
        dup,
      }),
    );
  }
  return lines.join('');
}

/**
 * Issues section, glyph row matches the `sm check` shape so the user
 * gets the same visual language across both verbs. The "from <path>"
 * substring is stripped because the path is already in the node
 * header — no point repeating it on every issue row.
 */
function renderIssuesSection(issues: Issue[], nodePath: string, ansi: IAnsi): string {
  const lines: string[] = [tx(SHOW_TEXTS.issuesSection, { count: issues.length })];
  const ruleWidth = Math.max(
    ...issues.map((i) => sanitizeForTerminal(i.ruleId).length),
  );
  for (const issue of issues) {
    const ruleId = sanitizeForTerminal(issue.ruleId).padEnd(ruleWidth);
    const message = trimRedundantPath(sanitizeForTerminal(issue.message), nodePath);
    lines.push(
      tx(SHOW_TEXTS.issueRow, {
        glyph: severityGlyph(issue.severity, ansi),
        ruleId: ansi.dim(ruleId),
        message,
      }),
    );
  }
  return lines.join('');
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

function trimRedundantPath(message: string, nodePath: string): string {
  if (!nodePath) return message;
  const needle = ` from ${nodePath}`;
  if (!message.includes(needle)) return message;
  return message.replace(needle, '');
}

interface IGroupedLink {
  /** The "other end" path: target for outgoing groups, source for incoming. */
  endpoint: string;
  kind: Link['kind'];
  /** Highest confidence across the group (rank: high > medium > low). */
  confidence: Link['confidence'];
  /** Union of all extractor ids that emitted any row in the group, sorted. */
  sources: string[];
  /** Original row count — informational, mirrors what `linksOut.length` showed before grouping. */
  rowCount: number;
  /** Trigger normalized form, when every row in the group agrees on it. `null` when the trigger is absent or differs. */
  normalizedTrigger: string | null;
}

/**
 * Group a flat link array by `(endpoint, kind, normalizedTrigger or null)`.
 * Used by the human renderer to collapse rows emitted by multiple
 * extractors for the same conceptual link into a single line. Storage
 * keeps the raw rows; `--json` emits them unchanged.
 *
 * `endpointSide` picks which end of the link is the "other" node:
 * `'target'` for outgoing links, `'source'` for incoming.
 */
// eslint-disable-next-line complexity
function aggregateLinks(links: Link[], endpointSide: 'target' | 'source'): IGroupedLink[] {
  const groups = new Map<string, IGroupedLink>();
  for (const link of links) {
    const endpoint = endpointSide === 'target' ? link.target : link.source;
    const trigger = link.trigger?.normalizedTrigger ?? null;
    // NUL separator — collision-free against any path (POSIX paths
    // cannot contain NUL) or trigger string. The null-trigger case
    // gets its own bucket key via the empty trailing component.
    const key = `${endpoint}\x00${link.kind}\x00${trigger ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      for (const src of link.sources) {
        if (!existing.sources.includes(src)) existing.sources.push(src);
      }
      if (rankConfidenceForGrouping(link.confidence) > rankConfidenceForGrouping(existing.confidence)) {
        existing.confidence = link.confidence;
      }
      existing.rowCount += 1;
    } else {
      groups.set(key, {
        endpoint,
        kind: link.kind,
        confidence: link.confidence,
        sources: [...link.sources],
        rowCount: 1,
        normalizedTrigger: trigger,
      });
    }
  }
  // Deterministic order: by endpoint, then kind. Sources inside each
  // group are sorted at the moment we render so additions during
  // grouping don't pay a sort per insert.
  for (const grp of groups.values()) grp.sources.sort();
  return [...groups.values()].sort((a, b) => {
    if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
    return a.kind.localeCompare(b.kind);
  });
}

const CONFIDENCE_RANK: Record<Link['confidence'], number> = {
  high: 2,
  medium: 1,
  low: 0,
};

function rankConfidenceForGrouping(c: Link['confidence']): number {
  return CONFIDENCE_RANK[c];
}
