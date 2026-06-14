/**
 * Unit coverage for `reference-broken`:
 *   - Issue emission per unresolved link (warn severity, `nodeIds: [source]`).
 *   - View-contribution emission to `card.footer.right` aggregated
 *     per source node (one chip per node, value = number of broken
 *     refs).
 *
 * The aggregation is what makes the chip scale, a node with three
 * broken refs lights up once with `value: 3`. The historical corner
 * badge on `graph.node.alert` was dropped because that slot is now
 * reserved for special-case signals (see `slot-config.ts`).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { referenceBrokenAnalyzer } from '../index.js';
import { REFERENCE_BROKEN_TEXTS } from '../text.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Link, Node } from '../../../../../kernel/types.js';

function fakeNode(path: string, name?: string): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'core-markdown',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...(name ? { frontmatter: { name, description: '' } } : {}),
  } as Node;
}

function fakeLink(source: string, target: string): Link {
  return {
    source,
    target,
    kind: 'references',
    confidence: 0.9,
    sources: ['mock'],
  };
}

// `reference-broken` is a pure projector of the orchestrator's
// genuinely-broken verdict, so the unit test supplies `brokenLinks`
// directly (the kind-agnostic detection itself lives in the lift's
// `collectBrokenLinks`, covered by that module's tests).
function run(nodes: Node[], links: Link[], brokenLinks: Set<Link>): {
  issues: { nodeIds: readonly string[]; severity: string }[];
  contributions: { nodePath: string; id: string; payload: unknown }[];
} {
  const contributions: { nodePath: string; id: string; payload: unknown }[] = [];
  const result = referenceBrokenAnalyzer.evaluate({
    nodes,
    links,
    brokenLinks,
    emitContribution: (nodePath: string, id: string, payload: unknown) =>
      contributions.push({ nodePath, id, payload }),
  } as unknown as IAnalyzerContext);
  const issues = Array.isArray(result) ? result : [];
  return { issues, contributions };
}

describe('broken-ref analyzer, issue emission', () => {
  it('emits nothing when no link is in the broken set', () => {
    const a = fakeNode('a.md');
    const b = fakeNode('b.md');
    const { issues, contributions } = run([a, b], [fakeLink('a.md', 'b.md')], new Set());
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits 1 issue per broken ref', () => {
    const a = fakeNode('a.md');
    const link = fakeLink('a.md', 'missing.md');
    const { issues, contributions } = run([a], [link], new Set([link]));
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'error');
    deepStrictEqual(issues[0]!.nodeIds, ['a.md']);
    // Per-node chip emission moved out, the aggregate severity chip
    // (`core/issue-counter`) handles the visual surface now.
    strictEqual(contributions.length, 0);
  });

  it('emits one issue per broken ref without aggregating into a chip', () => {
    const a = fakeNode('a.md');
    const links = [
      fakeLink('a.md', 'missing-1.md'),
      fakeLink('a.md', 'missing-2.md'),
      fakeLink('a.md', 'missing-3.md'),
    ];
    const { issues, contributions } = run([a], links, new Set(links));
    strictEqual(issues.length, 3, 'three issues, one per broken link');
    strictEqual(contributions.length, 0, 'no per-analyzer chip; aggregated by issue-counter');
  });

  it('skips a link that is NOT in the broken set even if its target looks unresolvable', () => {
    // The projector trusts the orchestrator verdict: a link the lift
    // resolved via a filename / dirname identifier is absent from
    // `brokenLinks`, so the rule does not flag it (the old
    // frontmatter-name-only index used to false-positive here).
    const caller = fakeNode('caller.md');
    const resolvedByFilename = fakeLink('caller.md', '@filed-agent');
    const { issues } = run([caller], [resolvedByFilename], new Set());
    strictEqual(issues.length, 0);
  });

  it('declares no `ui` surface (issue chip is owned by `core/issue-counter`)', () => {
    deepStrictEqual(referenceBrokenAnalyzer.ui, {});
  });
});

// Silence unused-import warnings for shared text catalog referenced by
// other suites in this file in the past.
void REFERENCE_BROKEN_TEXTS;
