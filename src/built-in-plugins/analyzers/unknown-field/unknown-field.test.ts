/**
 * Unit coverage for the dual surface of `unknown-field`:
 *   - Issue emission per unknown key (warn severity, `nodeIds: [path]`).
 *   - View-contribution emissions to `graph.node.alert` and
 *     `card.footer.right` aggregated per node (one badge / chip per
 *     node, count = number of unknown fields across all three surfaces:
 *     annotations / root / plugin-namespace).
 *
 * The aggregation matters: a sidecar with three typos lights up once
 * with `count: 3`, not three overlapping markers. This complements the
 * issue-surface coverage in `src/test/unknown-field-analyzer.test.ts`.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { unknownFieldAnalyzer } from './index.js';
import { UNKNOWN_FIELD_TEXTS } from '../../i18n/unknown-field.texts.js';
import type { IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { Node } from '../../../kernel/types.js';

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
  const result = unknownFieldAnalyzer.evaluate({
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

describe('unknown-field analyzer — dual surface (issue + alert + chip)', () => {
  it('emits nothing when the sidecar root is empty', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
    });
    strictEqual(issues, 0);
    strictEqual(contributions.length, 0);
  });

  it('1 unknown annotations key → 1 issue + alert (icon-only) + chip (icon-only via value=0)', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { versoin: 1 }, // typo
    });
    strictEqual(issues, 1);
    strictEqual(contributions.length, 2);
    const alert = contributions.find((c) => c.id === 'alert')!;
    const chip = contributions.find((c) => c.id === 'chip')!;
    deepStrictEqual(alert.payload, {
      icon: 'fa-solid fa-triangle-exclamation',
      severity: 'warn',
      tooltip: UNKNOWN_FIELD_TEXTS.alertTooltipSingle,
    });
    deepStrictEqual(chip.payload, {
      value: 0,
      severity: 'warn',
      tooltip: UNKNOWN_FIELD_TEXTS.alertTooltipSingle,
    });
  });

  it('aggregates across surfaces — 3 unknowns emit 1 alert + 1 chip, both icon-only (no count in either payload)', () => {
    const { issues, contributions } = run({
      identity: { path: 'agents/architect.md', bodyHash: 'a'.repeat(64), frontmatterHash: 'b'.repeat(64) },
      annotations: { versoin: 1, stabiliti: 'experimental' }, // 2 typos
      'not-a-real-plugin': { foo: 'bar' }, // 1 unknown root
    });
    strictEqual(issues, 3, 'three issues across surfaces');
    const alerts = contributions.filter((c) => c.id === 'alert');
    const chips = contributions.filter((c) => c.id === 'chip');
    strictEqual(alerts.length, 1);
    strictEqual(chips.length, 1);
    strictEqual(
      (alerts[0]!.payload as { count?: number }).count,
      undefined,
      'alert payload must not include count — the icon is the sole signal',
    );
    strictEqual(
      (chips[0]!.payload as { value: number }).value,
      0,
      'chip payload must emit value: 0 so NodeCounter renders icon-only',
    );
  });

  it('declares both contribution slots (graph.node.alert + card.footer.right)', () => {
    deepStrictEqual(unknownFieldAnalyzer.viewContributions, {
      alert: {
        slot: 'graph.node.alert',
        icon: 'fa-solid fa-triangle-exclamation',
        emitWhenEmpty: false,
      },
      chip: {
        slot: 'card.footer.right',
        icon: 'pi-question-circle',
        emitWhenEmpty: true,
        priority: 30,
      },
    });
  });
});
