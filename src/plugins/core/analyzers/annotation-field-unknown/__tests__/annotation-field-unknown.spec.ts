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
import { ANNOTATION_FIELD_UNKNOWN_TEXTS } from '../annotation-field-unknown.texts.js';
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

describe('unknown-field analyzer, issue emission', () => {
  it('emits nothing when the sidecar root is empty', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
    });
    strictEqual(issues, 0);
    strictEqual(contributions.length, 0);
  });

  it('1 unknown annotations key → 1 issue, no chip (aggregator owns the chip)', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { versoin: 1 }, // typo
    });
    strictEqual(issues, 1);
    strictEqual(contributions.length, 0);
  });

  it('aggregates across surfaces but emits no per-analyzer chip', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { versoin: 1, stabiliti: 'experimental' }, // 2 typos
      'not-a-real-plugin': { foo: 'bar' }, // 1 unknown root
    });
    strictEqual(issues, 3, 'three issues across surfaces');
    strictEqual(contributions.length, 0, 'no per-analyzer chip; aggregated by issue-counter');
  });

  it('declares no `ui` surface (issue chip is owned by `core/issue-counter`)', () => {
    deepStrictEqual(annotationFieldUnknownAnalyzer.ui, {});
  });
});

// Silence unused imports left over from the removed chip-payload suite.
void ANNOTATION_FIELD_UNKNOWN_TEXTS;
