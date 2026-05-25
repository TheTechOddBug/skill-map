/**
 * Unit coverage for `annotation-field-unknown`:
 *   - Issue emission per unknown key (warn severity, `nodeIds: [path]`).
 *   - View-contribution emission to `card.footer.right` aggregated per
 *     node (one chip per node, count = number of unknown fields across
 *     all three surfaces: annotations / root / plugin-namespace).
 *
 * The aggregation matters: a sidecar with three typos lights up once
 * with the chip's tooltip carrying the count. The historical corner
 * badge on `graph.node.alert` was dropped because that slot is now
 * reserved for special-case signals (see `slot-config.ts`).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { annotationFieldUnknownAnalyzer } from '../index.js';
import { ANNOTATION_FIELD_UNKNOWN_TEXTS } from '../text.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Node } from '../../../../../kernel/types.js';

function fakeNode(path: string): Node {
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
  };
}

function run(sidecarRoot: Record<string, unknown>): {
  issues: number;
  contributions: { nodePath: string; id: string; payload: unknown }[];
} {
  const contributions: { nodePath: string; id: string; payload: unknown }[] = [];
  const node = fakeNode('agents/architect.md');
  const sidecarRoots = new Map<string, Record<string, unknown>>([[node.path, sidecarRoot]]);
  const result = annotationFieldUnknownAnalyzer.evaluate({
    nodes: [node],
    links: [],
    sidecarRoots,
    annotationContributions: [],
    emitContribution: (nodePath: string, id: string, payload: unknown) =>
      contributions.push({ nodePath, id, payload }),
  } as unknown as IAnalyzerContext);
  const issues = Array.isArray(result) ? result : [];
  return { issues: issues.length, contributions };
}

describe('unknown-field analyzer, issue + chip surface', () => {
  it('emits nothing when the sidecar root is empty', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
    });
    strictEqual(issues, 0);
    strictEqual(contributions.length, 0);
  });

  it('1 unknown annotations key → 1 issue + chip (icon-only via value=0)', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { versoin: 1 }, // typo
    });
    strictEqual(issues, 1);
    strictEqual(contributions.length, 1);
    const chip = contributions[0]!;
    strictEqual(chip.id, 'chip');
    deepStrictEqual(chip.payload, {
      value: 0,
      severity: 'warn',
      tooltip: ANNOTATION_FIELD_UNKNOWN_TEXTS.alertTooltipSingle,
    });
  });

  it('aggregates across surfaces, 3 unknowns emit 1 chip (icon-only via value=0)', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { versoin: 1, stabiliti: 'experimental' }, // 2 typos
      'not-a-real-plugin': { foo: 'bar' }, // 1 unknown root
    });
    strictEqual(issues, 3, 'three issues across surfaces');
    const chips = contributions.filter((c) => c.id === 'chip');
    strictEqual(chips.length, 1);
    strictEqual(
      (chips[0]!.payload as { value: number }).value,
      0,
      'chip payload must emit value: 0 so NodeCounter renders icon-only',
    );
  });

  it('declares only the chip slot (graph.node.alert reserved for special signals)', () => {
    deepStrictEqual(annotationFieldUnknownAnalyzer.ui, {
      chip: {
        slot: 'card.footer.right',
        icon: 'pi-question-circle',
        emitWhenEmpty: true,
        priority: 30,
      },
    });
  });
});
