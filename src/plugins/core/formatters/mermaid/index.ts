/**
 * `mermaid` formatter. Renders the graph as a Mermaid `flowchart` for
 * `sm graph --format mermaid` and `sm export <query> --format mermaid`
 * (both flags are promised by `spec/cli-contract.md` §Browse).
 *
 * Output layout:
 *
 *   flowchart LR
 *   %% skill-map graph: 3 nodes, 2 links, 0 issues
 *     n0[".claude/agents/architect.md"]
 *     n1[".claude/commands/deploy.md"]
 *     n2["docs/notes.md"]
 *     n0 -->|"invokes"| n1
 *     n0 -->|"references"| n2
 *     classDef kind_agent fill:#e3f2fd,stroke:#1565c0,color:#0d47a1;
 *     classDef kind_command fill:#ede7f6,stroke:#5e35b1,color:#311b92;
 *     class n0 kind_agent;
 *     class n1 kind_command;
 *
 * Design decisions, each verified against the current Mermaid docs
 * (`packages/mermaid/src/docs/syntax/flowchart.md`) rather than guessed:
 *
 * **Direction `LR`.** Node labels are file paths, the longest strings in
 * the document. Left-to-right puts each hop in its own COLUMN, so a long
 * label stretches the diagram along the axis that scrolls (horizontal)
 * instead of forcing very wide rows in a `TD` layout. Reference graphs
 * are also shallow and wide (one agent points at many commands), which
 * is exactly the shape `LR` renders compactly.
 *
 * **Synthetic node ids.** A path like `docs/a-b.md` is NOT a legal bare
 * Mermaid id: `-` and `.` are link-token characters (`-.` opens the
 * dotted-edge lexer state), so the parser would swallow part of the id
 * as an edge. Ids are therefore `n<index>` over the sorted path list:
 * collision-free by construction (no hash, no slug dedupe), stable for
 * a given graph, and free of the reserved words (`end`, `graph`,
 * `class`, ...) that break bare identifiers. The human path travels as
 * the node LABEL, quoted, which is the documented remedy for text with
 * special characters and the REQUIRED form for unicode text.
 *
 * **Label escaping.** Inside a quoted label the two characters the docs
 * name as breaking are `"` (terminates the string) and `#` (opens an
 * entity code). Both are escaped with Mermaid's own entity syntax,
 * `#quot;` and `#35;`, in that order (`#` first, otherwise the `#` of a
 * freshly written `#quot;` would be re-escaped). The HTML-flavoured
 * `&quot;` is deliberately NOT used: it is not in the documented
 * escaping contract and its behaviour depends on the renderer's
 * `htmlLabels` / `securityLevel` config. Single quotes need no escaping.
 *
 * **Link kind as an edge LABEL, not an arrow style.** Mermaid's arrow
 * vocabulary (`-->`, `-.->`, `==>`, `--o`, `--x`) carries no semantics a
 * reader could map onto `invokes` / `references` / `mentions` /
 * `points`; picking four styles would need a legend the diagram cannot
 * carry. A quoted label is self-describing, survives a paste into any
 * renderer, and the docs explicitly recommend the quoted `-->|"text"|`
 * form for label text the author does not control.
 *
 * **Node kind via `classDef` + `class`.** Only the kinds actually
 * present get a `classDef`, so a one-node graph emits exactly one style
 * line instead of the whole palette. Class assignment uses one `class`
 * statement per node (the form the docs show) rather than the
 * comma-separated node list, which is undocumented. Kinds are an OPEN
 * string set (an external Provider may declare `cursorRule`), so class
 * names are derived defensively: non-identifier characters collapse to
 * `_` and a numeric suffix breaks any resulting tie.
 *
 * **Link endpoints with no scanned node** (a broken reference, an
 * external URL pseudo-link) still get a node statement, so the edge has
 * something to point at, but no `class` assignment: the formatter knows
 * the path, not its kind, and inventing a kind would be a lie.
 *
 * **Issues** are NOT rendered. They are findings about the graph, not
 * graph elements; their count rides the header comment so the document
 * stays honest about what it omits.
 *
 * Determinism: nodes sort by path, edges by `(source, kind, target)`,
 * kinds alphabetically, all on UTF-16 code units (locale-independent).
 * The same graph always produces byte-identical output.
 *
 * No `contentType` is declared: the BFF route owns the format → MIME
 * map (`server/routes/graph.ts`), and a second declaration here would be
 * a source of drift nothing reads.
 *
 * Known unverified edge: whether a renderer accepts a `flowchart` whose
 * statement list is EMPTY is not covered by the Mermaid docs, and this
 * repo ships no Mermaid parser to test against. The empty graph emits
 * the declaration plus two comments rather than a fabricated placeholder
 * node, on the grounds that a diagram must not invent content that is
 * not in the scan.
 */

import type { IBuiltInManifest, IFormatter, IFormatterContext } from '../../../../kernel/extensions/index.js';
import type { Link, Node } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { compareCodeUnits, toSingleLineLabel } from '../label-text.js';
import { MERMAID_FORMATTER_TEXTS } from './mermaid.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'mermaid';

/** Prefix for generated node ids. Guarantees a letter-led identifier. */
const NODE_ID_PREFIX = 'n';

/** Prefix for generated `classDef` names. Same guarantee. */
const KIND_CLASS_PREFIX = 'kind_';

/** Characters legal in a generated class name; everything else folds to `_`. */
const CLASS_NAME_UNSAFE_RE = /[^A-Za-z0-9_]/g;

/**
 * Style palette assigned by the kind's position in the sorted kind
 * list, wrapping when a graph carries more kinds than entries. Fixed
 * order, so the same graph always paints the same colours. Each entry
 * is a Mermaid CSS property list (comma-separated, per `classDef`).
 */
const KIND_STYLES: readonly string[] = [
  'fill:#e3f2fd,stroke:#1565c0,color:#0d47a1',
  'fill:#ede7f6,stroke:#5e35b1,color:#311b92',
  'fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20',
  'fill:#fff3e0,stroke:#ef6c00,color:#e65100',
  'fill:#fce4ec,stroke:#ad1457,color:#880e4f',
  'fill:#e0f7fa,stroke:#00838f,color:#006064',
];

/** One rendered node: its synthetic id, its raw path, its kind (if known). */
interface IMermaidNodeRow {
  id: string;
  path: string;
  kind: string | null;
}

export const mermaidFormatter: IBuiltInManifest<IFormatter> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'formatter',
  formatId: ID,
  description:
    'Renders the scan as a Mermaid `flowchart LR`: one node per file (kind-coloured via `classDef`), one edge per link (labelled with the link kind). Used by `sm graph --format mermaid` and `sm export --format mermaid`.',

  format(ctx: IFormatterContext): string {
    const rows = buildNodeRows(ctx.nodes, ctx.links);
    const idByPath = new Map(rows.map((row) => [row.path, row.id]));
    const out: string[] = [MERMAID_FORMATTER_TEXTS.declaration];
    out.push(
      tx(MERMAID_FORMATTER_TEXTS.headerComment, {
        nodes: ctx.nodes.length,
        links: ctx.links.length,
        issues: ctx.issues.length,
      }),
    );
    if (rows.length === 0) out.push(MERMAID_FORMATTER_TEXTS.emptyComment);

    for (const row of rows) {
      out.push(
        tx(MERMAID_FORMATTER_TEXTS.node, { id: row.id, label: escapeLabel(row.path) }),
      );
    }
    out.push(...renderEdges(ctx.links, idByPath));
    out.push(...renderKindClasses(rows));
    return out.join('\n');
  },
};

/**
 * Project the graph into the rendered node list: every scanned node,
 * plus every link endpoint that has no scanned node behind it (a broken
 * reference or an external pseudo-target still needs something to point
 * at). Sorted by path, then indexed, so ids are stable per graph.
 */
function buildNodeRows(nodes: Node[], links: Link[]): IMermaidNodeRow[] {
  const kindByPath = new Map<string, string>();
  for (const node of nodes) {
    if (!kindByPath.has(node.path)) kindByPath.set(node.path, node.kind);
  }
  const paths = new Set<string>(kindByPath.keys());
  for (const link of links) {
    paths.add(link.source);
    paths.add(link.target);
  }
  return [...paths]
    .sort(compareCodeUnits)
    .map((path, index) => ({
      id: `${NODE_ID_PREFIX}${index}`,
      path,
      kind: kindByPath.get(path) ?? null,
    }));
}

/** Emit one edge statement per link, sorted by `(source, kind, target)`. */
function renderEdges(links: Link[], idByPath: Map<string, string>): string[] {
  const sorted = [...links].sort((a, b) =>
    compareCodeUnits(
      `${a.source}\u0000${a.kind}\u0000${a.target}`,
      `${b.source}\u0000${b.kind}\u0000${b.target}`,
    ),
  );
  const out: string[] = [];
  for (const link of sorted) {
    const source = idByPath.get(link.source);
    const target = idByPath.get(link.target);
    // Unreachable in practice: `buildNodeRows` indexes every endpoint.
    // Skipping rather than emitting a dangling id keeps a future caller
    // that hand-builds the context from producing a broken document.
    if (source === undefined || target === undefined) continue;
    out.push(
      tx(MERMAID_FORMATTER_TEXTS.edge, {
        source,
        target,
        kind: escapeLabel(link.kind),
      }),
    );
  }
  return out;
}

/**
 * Emit a `classDef` per kind present in the graph, then one `class`
 * assignment per node that has a kind. Rows whose kind is `null` (link
 * endpoints with no scanned node) are skipped on both passes.
 */
function renderKindClasses(rows: IMermaidNodeRow[]): string[] {
  const kinds = [...new Set(rows.map((row) => row.kind).filter(isKind))].sort(compareCodeUnits);
  if (kinds.length === 0) return [];
  const classNames = buildKindClassNames(kinds);
  const out: string[] = [];
  for (const [index, kind] of kinds.entries()) {
    out.push(
      tx(MERMAID_FORMATTER_TEXTS.classDef, {
        name: classNames.get(kind)!,
        style: KIND_STYLES[index % KIND_STYLES.length]!,
      }),
    );
  }
  for (const row of rows) {
    if (row.kind === null) continue;
    out.push(
      tx(MERMAID_FORMATTER_TEXTS.classAssign, {
        id: row.id,
        name: classNames.get(row.kind)!,
      }),
    );
  }
  return out;
}

/**
 * Map each kind to a legal, unique `classDef` name. Kinds are an open
 * string set, so anything outside `[A-Za-z0-9_]` folds to `_`; two kinds
 * that fold onto the same name (`a-b` and `a.b`) are separated by an
 * ascending numeric suffix, walking the pre-sorted list so the outcome
 * is deterministic.
 */
function buildKindClassNames(sortedKinds: string[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const kind of sortedKinds) {
    const base = KIND_CLASS_PREFIX + toSingleLineLabel(kind).replace(CLASS_NAME_UNSAFE_RE, '_');
    let name = base;
    let suffix = 2;
    while (taken.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    taken.add(name);
    out.set(kind, name);
  }
  return out;
}

/** Type guard narrowing the nullable kind out of the row list. */
function isKind(kind: string | null): kind is string {
  return kind !== null;
}

/**
 * Escape a string for use inside a DOUBLE-QUOTED Mermaid label. `#`
 * runs first: it opens an entity code, so escaping it after `"` would
 * corrupt the `#quot;` this function just wrote.
 */
function escapeLabel(text: string): string {
  return toSingleLineLabel(text)
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;');
}
