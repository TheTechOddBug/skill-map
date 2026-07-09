import { describe, expect, it } from 'vitest';

import type { INodeInvocation } from '../../../../services/node-activity';
import type { IPoint } from '../graph-layout';
import { resolveInvocationOverlay } from '../invocation-overlay';

const AT: IPoint = { x: 0, y: 0 };

const AGENT = '.claude/agents/reviewer.md';
const MCP = 'mcp://notion';

function inv(overrides: Partial<INodeInvocation>): INodeInvocation {
  return { target: MCP, caller: AGENT, detail: 'notion-create-pages', ...overrides };
}

describe('resolveInvocationOverlay', () => {
  it('emits a labeled caller -> target edge when both endpoints are visible + positioned', () => {
    const edges = resolveInvocationOverlay({
      invocations: [inv({})],
      visiblePaths: new Set([AGENT, MCP]),
      positionOf: () => AT,
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      key: `${AGENT}>>${MCP}`,
      outputId: `${AGENT}-out`,
      inputId: `${MCP}-in`,
      label: 'notion-create-pages',
    });
  });

  it('draws nothing when there is no correlated caller', () => {
    const edges = resolveInvocationOverlay({
      invocations: [inv({ caller: null })],
      visiblePaths: new Set([MCP]),
      positionOf: () => AT,
    });
    expect(edges).toHaveLength(0);
  });

  it('drops the edge when the caller is hidden or unpositioned', () => {
    expect(
      resolveInvocationOverlay({
        invocations: [inv({})],
        visiblePaths: new Set([MCP]), // caller filtered out
        positionOf: () => AT,
      }),
    ).toHaveLength(0);
    expect(
      resolveInvocationOverlay({
        invocations: [inv({})],
        visiblePaths: new Set([AGENT, MCP]),
        positionOf: (path) => (path === AGENT ? undefined : AT), // caller layout pending
      }),
    ).toHaveLength(0);
  });

  it('drops a self-edge (caller === target)', () => {
    const edges = resolveInvocationOverlay({
      invocations: [inv({ caller: MCP })],
      visiblePaths: new Set([MCP]),
      positionOf: () => AT,
    });
    expect(edges).toHaveLength(0);
  });
});
