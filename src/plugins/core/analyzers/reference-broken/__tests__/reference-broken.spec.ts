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

function run(nodes: Node[], links: Link[]): {
  issues: { nodeIds: readonly string[]; severity: string }[];
  contributions: { nodePath: string; id: string; payload: unknown }[];
} {
  const contributions: { nodePath: string; id: string; payload: unknown }[] = [];
  const result = referenceBrokenAnalyzer.evaluate({
    nodes,
    links,
    emitContribution: (nodePath: string, id: string, payload: unknown) =>
      contributions.push({ nodePath, id, payload }),
  } as unknown as IAnalyzerContext);
  const issues = Array.isArray(result) ? result : [];
  return { issues, contributions };
}

describe('broken-ref analyzer, issue + chip surface', () => {
  it('emits nothing when every link resolves', () => {
    const a = fakeNode('a.md');
    const b = fakeNode('b.md');
    const { issues, contributions } = run([a, b], [fakeLink('a.md', 'b.md')]);
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits 1 issue + chip (value=1) for a single broken ref', () => {
    const a = fakeNode('a.md');
    const { issues, contributions } = run([a], [fakeLink('a.md', 'missing.md')]);
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'warn');
    deepStrictEqual(issues[0]!.nodeIds, ['a.md']);
    strictEqual(contributions.length, 1);
    deepStrictEqual(contributions[0], {
      nodePath: 'a.md',
      id: 'chip',
      payload: {
        value: 1,
        severity: 'danger',
        tooltip: REFERENCE_BROKEN_TEXTS.alertTooltipSingle,
      },
    });
  });

  it('aggregates per source node, 3 broken refs from a.md emit 1 chip (value=3)', () => {
    const a = fakeNode('a.md');
    const links = [
      fakeLink('a.md', 'missing-1.md'),
      fakeLink('a.md', 'missing-2.md'),
      fakeLink('a.md', 'missing-3.md'),
    ];
    const { issues, contributions } = run([a], links);
    strictEqual(issues.length, 3, 'three issues, one per broken link');
    const chips = contributions.filter((c) => c.id === 'chip');
    strictEqual(chips.length, 1, 'one chip per node, aggregated');
    const chipPayload = chips[0]!.payload as { value: number; tooltip: string };
    strictEqual(chipPayload.value, 3);
    strictEqual(
      chipPayload.tooltip,
      `This node has 3 broken references. Open the inspector for details.`,
    );
  });

  it('caps the chip value at 99 (slot schema limit)', () => {
    const a = fakeNode('a.md');
    const links = Array.from({ length: 150 }, (_, i) => fakeLink('a.md', `missing-${i}.md`));
    const { contributions } = run([a], links);
    const chip = contributions.find((c) => c.id === 'chip')!;
    strictEqual((chip.payload as { value: number }).value, 99);
  });

  it('declares only the chip slot (graph.node.alert reserved for special signals)', () => {
    deepStrictEqual(referenceBrokenAnalyzer.ui, {
      chip: {
        slot: 'card.footer.right',
        icon: 'fa-solid fa-circle-xmark',
        emitWhenEmpty: false,
        priority: 40,
      },
    });
  });
});
