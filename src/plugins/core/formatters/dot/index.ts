/**
 * `dot` formatter. Renders the graph as a Graphviz `digraph` for
 * `sm graph --format dot` (promised by `spec/cli-contract.md` §Browse).
 * The output is meant to be piped straight into Graphviz:
 *
 *   sm graph --format dot | dot -Tsvg > graph.svg
 *
 * Output layout:
 *
 *   digraph "skill-map" {
 *     // skill-map graph: 3 nodes, 2 links, 0 issues
 *     rankdir="LR";
 *     ".claude/agents/architect.md" [label=".claude/agents/architect.md\nagent"];
 *     ".claude/commands/deploy.md" [label=".claude/commands/deploy.md\ncommand"];
 *     "docs/notes.md" [label="docs/notes.md\nmarkdown"];
 *     ".claude/agents/architect.md" -> ".claude/commands/deploy.md" [label="invokes"];
 *     ".claude/agents/architect.md" -> "docs/notes.md" [label="references"];
 *   }
 *
 * Design decisions, each verified against the current Graphviz docs
 * (`graphviz.org/doc/info/lang.html`, `graphviz.org/docs/attr-types/escString`)
 * rather than guessed:
 *
 * **The node path IS the node id.** Unlike Mermaid, DOT has no
 * restriction on the CONTENT of a double-quoted id: the docs state there
 * is no semantic difference between the quoted and unquoted forms of an
 * id, and quoting is the documented way to use punctuation or a reserved
 * keyword. So every id is emitted quoted and no synthetic mapping is
 * needed, which keeps the emitted document greppable (`grep 'notes.md'`
 * finds the node and both its edges).
 *
 * **Escaping runs backslash-first, then quote.** DOT has two layers and
 * conflating them is the classic generator bug. At the LEXICAL layer the
 * only character needing an escape is `"` (as `\"`); a backslash passes
 * through untouched. At the LABEL layer, though, the value is an
 * `escString`: `\N` substitutes the node name, `\G` the graph name,
 * `\l` / `\r` / `\n` insert line breaks, `\\` yields one literal
 * backslash, and a backslash before an unrecognised character is
 * DROPPED. So a path containing `\New` would silently render as the node
 * name unless the backslash is doubled. The formatter escapes `\` to
 * `\\` FIRST and `"` to `\"` second; doing it in the other order would
 * re-escape the backslash the quote escape just introduced.
 *
 * **Node kind on a second label line.** DOT has no `classDef`
 * equivalent that stays "minimal and standard", and colouring by kind
 * would mean inventing a palette Graphviz users would then have to
 * override. The kind is instead appended to the label after a literal
 * `\n` (the documented centred line break inside an `escString`), so it
 * renders with no extra flags in every output format. Inserted AFTER
 * each part is escaped, so it can never be confused with a `\n` that
 * came from the data.
 *
 * **Edge labels carry the link kind**, same reasoning as the `mermaid`
 * formatter: `invokes` / `references` / `mentions` / `points` have no
 * natural mapping onto arrowheads or line styles.
 *
 * **Link endpoints with no scanned node** (a broken reference, an
 * external URL pseudo-link) still get a node statement so the edge has
 * something to point at, but their label is the bare path with no kind
 * line: the formatter knows the path, not its kind.
 *
 * **Attributes stay minimal**: one graph-level `rankdir="LR"` (matching
 * the `mermaid` formatter's orientation) plus a `label` per node and per
 * edge. No `charset` (UTF-8 is already the documented default, so
 * unicode paths need no extra flags), no fonts, no shapes, no colours:
 * anything more would be this formatter imposing a house style on the
 * operator's `dot` invocation.
 *
 * **Issues** are NOT rendered. They are findings about the graph, not
 * graph elements; their count rides the header comment.
 *
 * Determinism: nodes sort by path, edges by `(source, kind, target)`,
 * all on UTF-16 code units (locale-independent). The same graph always
 * produces byte-identical output. An empty graph emits an empty
 * `digraph`, which the Graphviz docs use as their own example of valid
 * input (`echo 'digraph {}' | nop -p` passes).
 *
 * No `contentType` is declared: the BFF route owns the format → MIME
 * map (`server/routes/graph.ts`), and a second declaration here would be
 * a source of drift nothing reads.
 */

import type { IBuiltInManifest, IFormatter, IFormatterContext } from '../../../../kernel/extensions/index.js';
import type { Link, Node } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { compareCodeUnits, toSingleLineLabel } from '../label-text.js';
import { DOT_FORMATTER_TEXTS } from './dot.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'dot';

/**
 * DOT `escString` line break (centred). Two literal characters,
 * backslash + `n`, injected AFTER both label parts are escaped so it can
 * never collide with a backslash that came from the data.
 */
const LABEL_LINE_BREAK = '\\n';

/** One rendered node: its raw path and its kind (if any node declares one). */
interface IDotNodeRow {
  path: string;
  kind: string | null;
}

export const dotFormatter: IBuiltInManifest<IFormatter> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'formatter',
  formatId: ID,
  description:
    'Renders the scan as a Graphviz `digraph`: one node per file (labelled with its path and kind), one edge per link (labelled with the link kind). Pipe `sm graph --format dot` into `dot -Tsvg`.',

  format(ctx: IFormatterContext): string {
    const out: string[] = [DOT_FORMATTER_TEXTS.open];
    out.push(
      tx(DOT_FORMATTER_TEXTS.headerComment, {
        nodes: ctx.nodes.length,
        links: ctx.links.length,
        issues: ctx.issues.length,
      }),
      DOT_FORMATTER_TEXTS.rankDir,
    );
    for (const row of buildNodeRows(ctx.nodes, ctx.links)) {
      out.push(
        tx(DOT_FORMATTER_TEXTS.node, {
          id: escapeDotString(row.path),
          label: buildNodeLabel(row),
        }),
      );
    }
    out.push(...renderEdges(ctx.links));
    out.push(DOT_FORMATTER_TEXTS.close);
    return out.join('\n');
  },
};

/**
 * Project the graph into the rendered node list: every scanned node,
 * plus every link endpoint that has no scanned node behind it. Sorted by
 * path so the emitted document is stable.
 */
function buildNodeRows(nodes: Node[], links: Link[]): IDotNodeRow[] {
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
    .map((path) => ({ path, kind: kindByPath.get(path) ?? null }));
}

/**
 * Two-line label (`<path>\n<kind>`) for a scanned node, single-line for
 * a link endpoint whose kind is unknown.
 */
function buildNodeLabel(row: IDotNodeRow): string {
  const path = escapeDotString(row.path);
  if (row.kind === null) return path;
  return `${path}${LABEL_LINE_BREAK}${escapeDotString(row.kind)}`;
}

/** Emit one edge statement per link, sorted by `(source, kind, target)`. */
function renderEdges(links: Link[]): string[] {
  const sorted = [...links].sort((a, b) =>
    compareCodeUnits(
      `${a.source}\u0000${a.kind}\u0000${a.target}`,
      `${b.source}\u0000${b.kind}\u0000${b.target}`,
    ),
  );
  return sorted.map((link) =>
    tx(DOT_FORMATTER_TEXTS.edge, {
      source: escapeDotString(link.source),
      target: escapeDotString(link.target),
      kind: escapeDotString(link.kind),
    }),
  );
}

/**
 * Escape a string for use inside a DOUBLE-QUOTED DOT id or label.
 * Backslash runs FIRST (see the module docblock): escaping the quote
 * first would leave `\"` and the backslash pass would turn it into
 * `\\"`, re-opening the string.
 */
function escapeDotString(text: string): string {
  return toSingleLineLabel(text)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}
