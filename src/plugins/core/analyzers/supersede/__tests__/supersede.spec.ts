/**
 * Unit coverage for the `supersede` analyzer:
 *   - Emits NO issues (the declaration is owned by `core/node-superseded`).
 *   - Emits one `inspector.action.button` contribution per NON-virtual
 *     node, dispatching `core/node-supersede`, carrying the
 *     `single-string` prompt for the target path.
 *   - `enabled` is `true` when the node has no `supersededBy`, `false`
 *     (with `disabledReason`) when the sidecar already carries one.
 *   - Skips `virtual === true` nodes entirely.
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
  contributions: { nodePath: string; id: string; payload: unknown }[];
} {
  const contributions: { nodePath: string; id: string; payload: unknown }[] = [];
  return {
    ctx: {
      nodes,
      links: [],
      emitContribution: (nodePath: string, id: string, payload: unknown) =>
        contributions.push({ nodePath, id, payload }),
    } as unknown as IAnalyzerContext,
    contributions,
  };
}

function supersededSidecar(supersededBy: string): ISidecarOverlay {
  return { present: true, status: 'fresh', annotations: { supersededBy } };
}

const PROMPT = {
  inputType: 'single-string',
  paramKey: 'supersededBy',
  label: SUPERSEDE_TEXTS.supersedePromptLabel,
};

const ENABLED_BUTTON = {
  actionId: 'core/node-supersede',
  label: SUPERSEDE_TEXTS.supersedeLabel,
  icon: 'pi-arrow-right-arrow-left',
  enabled: true,
  prompt: PROMPT,
};

const DISABLED_BUTTON = {
  actionId: 'core/node-supersede',
  label: SUPERSEDE_TEXTS.supersedeLabel,
  icon: 'pi-arrow-right-arrow-left',
  enabled: false,
  disabledReason: SUPERSEDE_TEXTS.supersedeDisabledReason,
  prompt: PROMPT,
};

describe('supersede analyzer, inspector action button', () => {
  it('emits no issues', async () => {
    const node = mockNode('docs/a.md');
    const { ctx: c } = ctx([node]);
    const issues = await supersedeAnalyzer.evaluate(c);
    strictEqual(issues.length, 0);
  });

  it('emits an enabled button for a non-virtual node with no supersededBy', async () => {
    const node = mockNode('docs/a.md');
    const { ctx: c, contributions } = ctx([node]);
    await supersedeAnalyzer.evaluate(c);
    deepStrictEqual(contributions, [
      { nodePath: 'docs/a.md', id: 'supersedeButton', payload: ENABLED_BUTTON },
    ]);
  });

  it('emits an enabled button when the sidecar is present but carries no supersededBy', async () => {
    const node = mockNode('docs/a.md', {
      sidecar: { present: true, status: 'fresh', annotations: { version: 2 } },
    });
    const { ctx: c, contributions } = ctx([node]);
    await supersedeAnalyzer.evaluate(c);
    deepStrictEqual(contributions, [
      { nodePath: 'docs/a.md', id: 'supersedeButton', payload: ENABLED_BUTTON },
    ]);
  });

  it('emits a disabled button when the node is already superseded', async () => {
    const node = mockNode('docs/a.md', { sidecar: supersededSidecar('docs/b.md') });
    const { ctx: c, contributions } = ctx([node]);
    await supersedeAnalyzer.evaluate(c);
    deepStrictEqual(contributions, [
      { nodePath: 'docs/a.md', id: 'supersedeButton', payload: DISABLED_BUTTON },
    ]);
  });

  it('skips virtual nodes entirely (no contribution)', async () => {
    const node = mockNode('virtual/group', { virtual: true });
    const { ctx: c, contributions } = ctx([node]);
    await supersedeAnalyzer.evaluate(c);
    strictEqual(contributions.length, 0);
  });

  it('emits per non-virtual node and skips virtual ones in a mixed set', async () => {
    const real = mockNode('docs/a.md');
    const superseded = mockNode('docs/b.md', { sidecar: supersededSidecar('docs/a.md') });
    const virtual = mockNode('virtual/group', { virtual: true });
    const { ctx: c, contributions } = ctx([real, superseded, virtual]);
    await supersedeAnalyzer.evaluate(c);
    deepStrictEqual(contributions, [
      { nodePath: 'docs/a.md', id: 'supersedeButton', payload: ENABLED_BUTTON },
      { nodePath: 'docs/b.md', id: 'supersedeButton', payload: DISABLED_BUTTON },
    ]);
  });

  it('declares the inspector.action.button contribution slot', () => {
    deepStrictEqual(supersedeAnalyzer.ui, {
      supersedeButton: {
        slot: 'inspector.action.button',
        priority: 10,
      },
    });
  });
});
