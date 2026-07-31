/**
 * `mermaid` formatter, unit coverage of the emission contract:
 *
 *   - empty graph still emits a well-formed document (declaration line
 *     first, no orphan statements),
 *   - one node / many nodes with edges of different kinds,
 *   - escaping of the two characters the Mermaid docs name as breaking
 *     inside a quoted label (`"` → `#quot;`, `#` → `#35;`), plus the
 *     structural newline flattening, asserted on the ESCAPED form,
 *   - unicode survives verbatim (quoted labels are the documented way to
 *     carry it, no transliteration),
 *   - byte-for-byte determinism, including under a shuffled input order.
 *
 * The repo ships no Mermaid parser (adding one for a formatter would be
 * a heavy dependency for a graph the CLI never renders itself), so
 * "valid output" is asserted STRUCTURALLY: every emitted line has to
 * match one of the five statement shapes the formatter is allowed to
 * produce, quoting has to balance on every line, and the node / edge
 * counts have to match the input graph. `assertWellFormed` below is that
 * check and every test runs it.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';

import { mermaidFormatter } from '../index.js';
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
  return mermaidFormatter.format({ nodes, links, issues, settings: {} });
}

// --- structural validator ---------------------------------------------------

const DECLARATION = 'flowchart LR';
const COMMENT_RE = /^%% \S/;
const NODE_RE = /^ {2}n\d+\["[^"]*"\]$/;
const EDGE_RE = /^ {2}n\d+ -->\|"[^"]*"\| n\d+$/;
const CLASS_DEF_RE = /^ {2}classDef [A-Za-z_][A-Za-z0-9_]* [^;]+;$/;
const CLASS_ASSIGN_RE = /^ {2}class n\d+ [A-Za-z_][A-Za-z0-9_]*;$/;

interface IParsedDocument {
  nodeLines: string[];
  edgeLines: string[];
  classDefLines: string[];
  classAssignLines: string[];
}

/**
 * Assert the emitted text is a well-formed Mermaid flowchart: the
 * declaration leads, every subsequent line is one of the four statement
 * shapes or a comment, and no line carries unbalanced quoting. Returns
 * the parsed buckets so callers can assert counts.
 */
function assertWellFormed(out: string): IParsedDocument {
  const lines = out.split('\n');
  strictEqual(lines[0], DECLARATION, `first line must be the diagram declaration; got ${JSON.stringify(lines[0])}`);
  const parsed: IParsedDocument = {
    nodeLines: [],
    edgeLines: [],
    classDefLines: [],
    classAssignLines: [],
  };
  for (const line of lines.slice(1)) {
    // Quoting balance: `"` only ever appears as a delimiter (an escaped
    // quote is `#quot;`, which carries no `"` byte at all), so every
    // line must hold an even number of them.
    strictEqual(
      (line.match(/"/g) ?? []).length % 2,
      0,
      `unbalanced quoting on line ${JSON.stringify(line)}`,
    );
    if (COMMENT_RE.test(line)) continue;
    if (NODE_RE.test(line)) parsed.nodeLines.push(line);
    else if (EDGE_RE.test(line)) parsed.edgeLines.push(line);
    else if (CLASS_DEF_RE.test(line)) parsed.classDefLines.push(line);
    else if (CLASS_ASSIGN_RE.test(line)) parsed.classAssignLines.push(line);
    else ok(false, `unrecognised mermaid statement: ${JSON.stringify(line)}`);
  }
  return parsed;
}

// --- tests ------------------------------------------------------------------

describe('mermaid formatter', () => {
  it('emits a well-formed document for an empty graph', () => {
    const out = format([]);
    const parsed = assertWellFormed(out);
    deepStrictEqual(parsed, {
      nodeLines: [],
      edgeLines: [],
      classDefLines: [],
      classAssignLines: [],
    });
    match(out, /^flowchart LR\n/);
    match(out, /%% skill-map graph: 0 nodes, 0 links, 0 issues/);
    // The blank case says why it renders blank rather than looking truncated.
    match(out, /%% no nodes to render/);
  });

  it('renders a single node with its path as a quoted label', () => {
    const out = format([buildNode('agents/a.md')]);
    const parsed = assertWellFormed(out);
    deepStrictEqual(parsed.nodeLines, ['  n0["agents/a.md"]']);
    deepStrictEqual(parsed.edgeLines, []);
    // One kind in the graph, so exactly one classDef, not the whole palette.
    strictEqual(parsed.classDefLines.length, 1);
    deepStrictEqual(parsed.classAssignLines, ['  class n0 kind_agent;']);
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
      buildLink('commands/b.md', 'notes/c.md', 'mentions'),
    ];
    const parsed = assertWellFormed(format(nodes, links));

    deepStrictEqual(parsed.nodeLines, [
      '  n0["agents/a.md"]',
      '  n1["commands/b.md"]',
      '  n2["notes/c.md"]',
    ]);
    // Edge label carries the link kind; endpoints are the synthetic ids.
    deepStrictEqual(parsed.edgeLines, [
      '  n0 -->|"invokes"| n1',
      '  n0 -->|"references"| n2',
      '  n1 -->|"mentions"| n2',
    ]);
    strictEqual(parsed.classDefLines.length, 3, 'one classDef per kind present');
    deepStrictEqual(parsed.classAssignLines, [
      '  class n0 kind_agent;',
      '  class n1 kind_command;',
      '  class n2 kind_markdown;',
    ]);
  });

  it('gives a link endpoint with no scanned node an id but no kind class', () => {
    const out = format(
      [buildNode('agents/a.md')],
      [buildLink('agents/a.md', 'missing/target.md', 'references')],
    );
    const parsed = assertWellFormed(out);
    deepStrictEqual(parsed.nodeLines, [
      '  n0["agents/a.md"]',
      '  n1["missing/target.md"]',
    ]);
    deepStrictEqual(parsed.edgeLines, ['  n0 -->|"references"| n1']);
    // Only the scanned node is classed; the dangling endpoint's kind is
    // unknown and the formatter refuses to invent one.
    deepStrictEqual(parsed.classAssignLines, ['  class n0 kind_agent;']);
  });

  it('escapes double quotes as #quot; and hashes as #35; inside the label', () => {
    const out = format([buildNode('docs/say "hi" #1.md')]);
    const parsed = assertWellFormed(out);
    deepStrictEqual(parsed.nodeLines, ['  n0["docs/say #quot;hi#quot; #35;1.md"]']);
    // The raw characters must NOT survive: a bare `"` would terminate
    // the label and a bare `#` would open an entity code.
    ok(!parsed.nodeLines[0]!.includes('say "hi"'), 'raw quotes must not survive');
    // Escape order matters: `#` runs first, so the `#` of a freshly
    // written `#quot;` is never re-escaped into `#35;quot;`.
    ok(!out.includes('#35;quot;'), 'escape order must not double-escape #quot;');
  });

  it('keeps spaces and unicode verbatim inside the quoted label', () => {
    const out = format([buildNode('docs/mis notas ñ 日本語 ✅.md')]);
    const parsed = assertWellFormed(out);
    deepStrictEqual(parsed.nodeLines, ['  n0["docs/mis notas ñ 日本語 ✅.md"]']);
  });

  it('flattens newlines and control bytes so one node stays one line', () => {
    const out = format([buildNode('docs/a\nb\tc\x07d.md')]);
    const parsed = assertWellFormed(out);
    // `\n` and `\t` collapse to a single space, BEL is dropped outright.
    deepStrictEqual(parsed.nodeLines, ['  n0["docs/a b cd.md"]']);
    strictEqual(parsed.nodeLines.length, 1, 'one node must produce exactly one line');
  });

  it('derives a legal, collision-free class name from an exotic node kind', () => {
    const parsed = assertWellFormed(
      format([buildNode('a.md', 'cursor.rule'), buildNode('b.md', 'cursor-rule')]),
    );
    // Both kinds fold to `kind_cursor_rule`; the tie breaks with an
    // ascending suffix, walking the sorted kind list (`-` < `.`).
    deepStrictEqual(parsed.classAssignLines, [
      '  class n0 kind_cursor_rule_2;',
      '  class n1 kind_cursor_rule;',
    ]);
    strictEqual(parsed.classDefLines.length, 2);
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
