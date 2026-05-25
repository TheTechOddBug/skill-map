/**
 * Unit coverage for the dual surface of `reference-broken`:
 *   - Issue emission per unresolved link (warn severity, `nodeIds: [source]`).
 *   - View-contribution emissions to `graph.node.alert` and
 *     `card.footer.right` aggregated per source node (one badge / chip
 *     per node, count = number of broken refs on that node).
 *
 * The aggregation is what makes the badges scale, a node with three
 * broken refs lights up once with `count: 3`, not three overlapping
 * markers. This file locks that contract.
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

describe('broken-ref analyzer, dual surface (issue + alert + chip)', () => {
  it('emits nothing when every link resolves', () => {
    const a = fakeNode('a.md');
    const b = fakeNode('b.md');
    const { issues, contributions } = run([a, b], [fakeLink('a.md', 'b.md')]);
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits 1 issue + alert (no count) + chip (value=1) for a single broken ref', () => {
    const a = fakeNode('a.md');
    const { issues, contributions } = run([a], [fakeLink('a.md', 'missing.md')]);
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'warn');
    deepStrictEqual(issues[0]!.nodeIds, ['a.md']);
    strictEqual(contributions.length, 2);
    deepStrictEqual(contributions[0], {
      nodePath: 'a.md',
      id: 'alert',
      payload: {
        icon: 'fa-solid fa-circle-xmark',
        severity: 'danger',
        tooltip: REFERENCE_BROKEN_TEXTS.alertTooltipSingle,
      },
    });
    deepStrictEqual(contributions[1], {
      nodePath: 'a.md',
      id: 'chip',
      payload: {
        value: 1,
        severity: 'danger',
        tooltip: REFERENCE_BROKEN_TEXTS.alertTooltipSingle,
      },
    });
  });

  it('aggregates per source node, 3 broken refs from a.md emit 1 alert (icon-only) + 1 chip (value=3)', () => {
    const a = fakeNode('a.md');
    const links = [
      fakeLink('a.md', 'missing-1.md'),
      fakeLink('a.md', 'missing-2.md'),
      fakeLink('a.md', 'missing-3.md'),
    ];
    const { issues, contributions } = run([a], links);
    strictEqual(issues.length, 3, 'three issues, one per broken link');
    // Only ONE alert + ONE chip per node, aggregated. The alert is
    // icon-only (no count), the count lives in the footer chip.
    const alerts = contributions.filter((c) => c.id === 'alert');
    const chips = contributions.filter((c) => c.id === 'chip');
    strictEqual(alerts.length, 1);
    strictEqual(chips.length, 1);
    const alertPayload = alerts[0]!.payload as { count?: number; tooltip: string };
    strictEqual(alertPayload.count, undefined, 'alert payload must not include count');
    strictEqual(
      alertPayload.tooltip,
      `This node has 3 broken references. Open the inspector for details.`,
    );
    const chipPayload = chips[0]!.payload as { value: number };
    strictEqual(chipPayload.value, 3);
  });

  it('caps the chip value at 99 (slot schema limit)', () => {
    const a = fakeNode('a.md');
    const links = Array.from({ length: 150 }, (_, i) => fakeLink('a.md', `missing-${i}.md`));
    const { contributions } = run([a], links);
    const alert = contributions.find((c) => c.id === 'alert')!;
    const chip = contributions.find((c) => c.id === 'chip')!;
    strictEqual((alert.payload as { count?: number }).count, undefined);
    strictEqual((chip.payload as { value: number }).value, 99);
  });

  it('declares both contribution slots (graph.node.alert + card.footer.right)', () => {
    deepStrictEqual(referenceBrokenAnalyzer.ui, {
      alert: {
        slot: 'graph.node.alert',
        icon: 'fa-solid fa-circle-xmark',
        emitWhenEmpty: false,
      },
      chip: {
        slot: 'card.footer.right',
        icon: 'fa-regular fa-circle-xmark',
        emitWhenEmpty: false,
        priority: 40,
      },
    });
  });
});
