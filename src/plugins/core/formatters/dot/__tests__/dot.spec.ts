/**
 * `dot` formatter, unit coverage of the emission contract:
 *
 *   - empty graph emits a valid empty `digraph` (the Graphviz docs use
 *     `digraph {}` as their own example of syntactically valid input),
 *   - one node / many nodes with edges of different kinds,
 *   - escaping asserted on the ESCAPED form: `\` → `\\` and `"` → `\"`,
 *     in that order, because a lone backslash before `N` / `G` / `l`
 *     would otherwise be interpreted by the label engine,
 *   - unicode survives verbatim (UTF-8 is the documented default charset,
 *     so `dot -Tsvg` needs no extra flags),
 *   - byte-for-byte determinism, including under a shuffled input order.
 *
 * The repo ships no Graphviz binary or parser, so "valid output" is
 * asserted STRUCTURALLY: the document opens and closes exactly once,
 * every inner line matches one of the three statement shapes the
 * formatter may produce, and every line's UNESCAPED quotes balance
 * (`countUnescapedQuotes` peels `\\` then `\"` before counting, which is
 * the same two-layer reading Graphviz applies).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';

import { dotFormatter } from '../index.js';
import type { Issue, Link, Node } from '../../../../../kernel/types.js';

function buildNode(path: string, kind = 'agent'): Node {
  return {
    path,
    kind,
    provider: 'claude',
    bodyHash: 'b'.repeat(64),
    frontmatterHash: 'f'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {},
  };
}

function buildLink(source: string, target: string, kind: Link['kind'] = 'invokes'): Link {
  return { source, target, kind, confidence: 0.9, sources: ['markdown-link'] };
}

function format(nodes: Node[], links: Link[] = [], issues: Issue[] = []): string {
  return dotFormatter.format({ nodes, links, issues, settings: {} });
}

// --- structural validator ---------------------------------------------------

const OPEN = 'digraph "skill-map" {';
const CLOSE = '}';
const COMMENT_RE = /^ {2}\/\/ \S/;
const RANK_DIR_RE = /^ {2}rankdir="LR";$/;
const NODE_RE = /^ {2}"(?:[^"\\]|\\.)*" \[label="(?:[^"\\]|\\.)*"\];$/;
const EDGE_RE = /^ {2}"(?:[^"\\]|\\.)*" -> "(?:[^"\\]|\\.)*" \[label="(?:[^"\\]|\\.)*"\];$/;

interface IParsedDocument {
  nodeLines: string[];
  edgeLines: string[];
}

/**
 * Count the quotes that actually delimit a DOT string: peel escaped
 * backslashes first (so `\\"` reads as an escaped backslash followed by
 * a delimiter), then escaped quotes, then count what remains.
 */
function countUnescapedQuotes(line: string): number {
  return (line.replace(/\\\\/g, '').replace(/\\"/g, '').match(/"/g) ?? []).length;
}

/**
 * Assert the emitted text is a well-formed DOT digraph: the header
 * opens it, the footer closes it, and every inner line is a comment, the
 * rank-direction attribute, a node statement, or an edge statement, with
 * balanced delimiters. Returns the parsed buckets so callers can assert
 * counts.
 */
function assertWellFormed(out: string): IParsedDocument {
  const lines = out.split('\n');
  strictEqual(lines[0], OPEN, `first line must open the digraph; got ${JSON.stringify(lines[0])}`);
  strictEqual(lines.at(-1), CLOSE, 'last line must close the digraph');
  const parsed: IParsedDocument = { nodeLines: [], edgeLines: [] };
  for (const line of lines.slice(1, -1)) {
    strictEqual(
      countUnescapedQuotes(line) % 2,
      0,
      `unbalanced quoting on line ${JSON.stringify(line)}`,
    );
    if (COMMENT_RE.test(line) || RANK_DIR_RE.test(line)) continue;
    if (NODE_RE.test(line)) parsed.nodeLines.push(line);
    else if (EDGE_RE.test(line)) parsed.edgeLines.push(line);
    else ok(false, `unrecognised dot statement: ${JSON.stringify(line)}`);
  }
  return parsed;
}

// --- tests ------------------------------------------------------------------

describe('dot formatter', () => {
  it('emits a valid empty digraph for an empty graph', () => {
    const out = format([]);
    const parsed = assertWellFormed(out);
    deepStrictEqual(parsed, { nodeLines: [], edgeLines: [] });
    match(out, /^digraph "skill-map" \{\n/);
    match(out, /\/\/ skill-map graph: 0 nodes, 0 links, 0 issues/);
    match(out, /\n\}$/);
  });

  it('renders a single node with the path as both id and label', () => {
    const parsed = assertWellFormed(format([buildNode('agents/a.md')]));
    deepStrictEqual(parsed.nodeLines, ['  "agents/a.md" [label="agents/a.md\\nagent"];']);
    deepStrictEqual(parsed.edgeLines, []);
  });

  it('renders several nodes with edges of different kinds', () => {
    const nodes = [
      buildNode('agents/a.md', 'agent'),
      buildNode('commands/b.md', 'command'),
      buildNode('notes/c.md', 'markdown'),
    ];
    const links = [
      buildLink('agents/a.md', 'commands/b.md', 'invokes'),
      buildLink('agents/a.md', 'notes/c.md', 'references'),
      buildLink('commands/b.md', 'notes/c.md', 'points'),
    ];
    const parsed = assertWellFormed(format(nodes, links));

    deepStrictEqual(parsed.nodeLines, [
      '  "agents/a.md" [label="agents/a.md\\nagent"];',
      '  "commands/b.md" [label="commands/b.md\\ncommand"];',
      '  "notes/c.md" [label="notes/c.md\\nmarkdown"];',
    ]);
    deepStrictEqual(parsed.edgeLines, [
      '  "agents/a.md" -> "commands/b.md" [label="invokes"];',
      '  "agents/a.md" -> "notes/c.md" [label="references"];',
      '  "commands/b.md" -> "notes/c.md" [label="points"];',
    ]);
  });

  it('labels a link endpoint with no scanned node with the bare path', () => {
    const parsed = assertWellFormed(
      format(
        [buildNode('agents/a.md')],
        [buildLink('agents/a.md', 'missing/target.md', 'references')],
      ),
    );
    // No kind line on the dangling endpoint: the formatter knows the
    // path, not the kind, and refuses to invent one.
    deepStrictEqual(parsed.nodeLines, [
      '  "agents/a.md" [label="agents/a.md\\nagent"];',
      '  "missing/target.md" [label="missing/target.md"];',
    ]);
    deepStrictEqual(parsed.edgeLines, [
      '  "agents/a.md" -> "missing/target.md" [label="references"];',
    ]);
  });

  it('escapes double quotes as \\" in both the id and the label', () => {
    const parsed = assertWellFormed(format([buildNode('docs/say "hi".md')]));
    deepStrictEqual(parsed.nodeLines, [
      '  "docs/say \\"hi\\".md" [label="docs/say \\"hi\\".md\\nagent"];',
    ]);
  });

  it('escapes a backslash as \\\\ so the label engine cannot read \\N as the node name', () => {
    const parsed = assertWellFormed(format([buildNode('docs/a\\New.md')]));
    // `\N` inside an unescaped escString substitutes the node name; the
    // doubled backslash makes it render as a literal `\N`.
    deepStrictEqual(parsed.nodeLines, [
      '  "docs/a\\\\New.md" [label="docs/a\\\\New.md\\nagent"];',
    ]);
    // Escape order matters: backslash runs first, so a path holding a
    // literal `\"` cannot end up as `\\"`, which would re-open the string.
    const withBoth = assertWellFormed(format([buildNode('docs/a\\"b.md')]));
    deepStrictEqual(withBoth.nodeLines, [
      '  "docs/a\\\\\\"b.md" [label="docs/a\\\\\\"b.md\\nagent"];',
    ]);
  });

  it('keeps spaces and unicode verbatim inside the quoted string', () => {
    const parsed = assertWellFormed(format([buildNode('docs/mis notas ñ 日本語 ✅.md')]));
    deepStrictEqual(parsed.nodeLines, [
      '  "docs/mis notas ñ 日本語 ✅.md" [label="docs/mis notas ñ 日本語 ✅.md\\nagent"];',
    ]);
  });

  it('flattens newlines and control bytes so one node stays one line', () => {
    const parsed = assertWellFormed(format([buildNode('docs/a\nb\tc\x07d.md')]));
    // A raw newline inside a quoted DOT string is not a documented
    // mechanism; it collapses to a space and BEL is dropped outright.
    deepStrictEqual(parsed.nodeLines, ['  "docs/a b cd.md" [label="docs/a b cd.md\\nagent"];']);
    strictEqual(parsed.nodeLines.length, 1, 'one node must produce exactly one line');
  });

  it('is byte-identical across repeated formats and input orderings', () => {
    const nodes = [
      buildNode('commands/b.md', 'command'),
      buildNode('agents/a.md', 'agent'),
      buildNode('notes/c.md', 'markdown'),
    ];
    const links = [
      buildLink('commands/b.md', 'notes/c.md', 'mentions'),
      buildLink('agents/a.md', 'commands/b.md', 'invokes'),
    ];
    const first = format(nodes, links);
    strictEqual(format(nodes, links), first, 'same input must format byte-identically');
    strictEqual(
      format([...nodes].reverse(), [...links].reverse()),
      first,
      'input ordering must not change the emitted bytes',
    );
  });
});
