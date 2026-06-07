/**
 * Unit coverage for the `supersede` analyzer:
 *   - Emits NO issues (the declaration is owned by `core/node-superseded`).
 *   - Emits one `inspector.action.button` per NON-virtual node dispatching
 *     `core/node-supersede`, with an `enum-pick` prompt whose options are
 *     the OTHER non-virtual nodes (node-picker + live-set validation by
 *     construction: only existing nodes are offered, never the node itself).
 *   - `enabled` is true when the node has no `supersededBy` AND there is at
 *     least one other node to point at; disabled (with reason) otherwise.
 *   - Skips `virtual === true` nodes entirely (not emitted, not offered).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { supersedeAnalyzer } from '../index.js';
import { SUPERSEDE_TEXTS } from '../text.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Node } from '../../../../../kernel/types.js';

function mockNode(path: string, overrides: Partial<Node> = {}): Node {
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
    ...overrides,
  };
}

function ctx(nodes: Node[]): {
  ctx: IAnalyzerContext;
  contributions: { nodePath: string; ref: unknown; payload: unknown }[];
} {
  const contributions: { nodePath: string; ref: unknown; payload: unknown }[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      emitContribution: (nodePath: string, ref: unknown, payload: unknown) =>
        contributions.push({ nodePath, ref, payload }),
    } as unknown as IAnalyzerContext,
    contributions,
  };
}

function supersededSidecar(supersededBy: string): ISidecarOverlay {
  return { present: true, status: 'fresh', annotations: { supersededBy } };
}

function options(...paths: string[]): { value: string; label: string }[] {
  return paths.map((p) => ({ value: p, label: p }));
}

function button(opts: {
  enabled: boolean;
  disabledReason?: string;
  options: { value: string; label: string }[];
}): Record<string, unknown> {
  return {
    actionId: 'core/node-supersede',
    label: SUPERSEDE_TEXTS.supersedeLabel,
    icon: 'pi-arrow-right-arrow-left',
    enabled: opts.enabled,
    ...(opts.disabledReason ? { disabledReason: opts.disabledReason } : {}),
    prompt: {
      inputType: 'enum-pick',
      paramKey: 'supersededBy',
      label: SUPERSEDE_TEXTS.supersedePromptLabel,
      options: opts.options,
    },
  };
}

describe('supersede analyzer, inspector action button', () => {
  it('emits no issues', async () => {
    const { ctx: c } = ctx([mockNode('docs/a.md'), mockNode('docs/b.md')]);
    const issues = await supersedeAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
  });

  it('disables the button when there is no other node to point at', async () => {
    const { ctx: c, contributions } = ctx([mockNode('docs/a.md')]);
    await supersedeAnalyzer.evaluate(c);
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, supersedeAnalyzer.ui!['supersedeButton']);
    deepStrictEqual(
      contributions[0]!.payload,
      button({
        enabled: false,
        disabledReason: SUPERSEDE_TEXTS.supersedeNoTargetsReason,
        options: [],
      }),
    );
  });

  it('enables the button with the OTHER nodes as picker options', async () => {
    const { ctx: c, contributions } = ctx([mockNode('docs/a.md'), mockNode('docs/b.md')]);
    await supersedeAnalyzer.evaluate(c);
    strictEqual(contributions.length, 2);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, supersedeAnalyzer.ui!['supersedeButton']);
    deepStrictEqual(contributions[0]!.payload, button({ enabled: true, options: options('docs/b.md') }));
    strictEqual(contributions[1]!.nodePath, 'docs/b.md');
    strictEqual(contributions[1]!.ref, supersedeAnalyzer.ui!['supersedeButton']);
    deepStrictEqual(contributions[1]!.payload, button({ enabled: true, options: options('docs/a.md') }));
  });

  it('disables the button when the node is already superseded (regardless of targets)', async () => {
    const { ctx: c, contributions } = ctx([
      mockNode('docs/a.md', { sidecar: supersededSidecar('docs/b.md') }),
      mockNode('docs/b.md'),
    ]);
    await supersedeAnalyzer.evaluate(c);
    strictEqual(contributions.length, 2);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, supersedeAnalyzer.ui!['supersedeButton']);
    deepStrictEqual(
      contributions[0]!.payload,
      button({
        enabled: false,
        disabledReason: SUPERSEDE_TEXTS.supersedeDisabledReason,
        options: options('docs/b.md'),
      }),
    );
    strictEqual(contributions[1]!.nodePath, 'docs/b.md');
    strictEqual(contributions[1]!.ref, supersedeAnalyzer.ui!['supersedeButton']);
    deepStrictEqual(contributions[1]!.payload, button({ enabled: true, options: options('docs/a.md') }));
  });

  it('skips virtual nodes entirely (not emitted, not offered as a target)', async () => {
    const { ctx: c, contributions } = ctx([
      mockNode('docs/a.md'),
      mockNode('virtual/group', { virtual: true }),
    ]);
    await supersedeAnalyzer.evaluate(c);
    // The only non-virtual node has no other non-virtual target, so it is
    // disabled, and the virtual node is neither emitted nor offered.
    strictEqual(contributions.length, 1);
    strictEqual(contributions[0]!.nodePath, 'docs/a.md');
    strictEqual(contributions[0]!.ref, supersedeAnalyzer.ui!['supersedeButton']);
    deepStrictEqual(
      contributions[0]!.payload,
      button({
        enabled: false,
        disabledReason: SUPERSEDE_TEXTS.supersedeNoTargetsReason,
        options: [],
      }),
    );
  });

  it('declares the inspector.action.button contribution slot', () => {
    deepStrictEqual(supersedeAnalyzer.ui, {
      supersedeButton: { slot: 'inspector.action.button', priority: 10 },
    });
  });
});
