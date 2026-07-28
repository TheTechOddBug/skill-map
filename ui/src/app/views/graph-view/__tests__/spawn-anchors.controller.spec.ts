/**
 * Wiring tests for `setupSpawnAnchors`, focused on the teardown
 * contract: the session-anchor and agent-capsule drags register
 * `{ once: true }` `mouseup` listeners on `document`, and a host
 * destroyed mid-drag must detach them so the callbacks cannot run
 * against torn-down state (mirrors `node-drag.controller.spec.ts`).
 * The overlay math itself is covered by the spawn-overlay and
 * graph-view specs.
 */

import { signal, type DestroyRef } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import type { IDataSourcePort } from '../../../../services/data-source/data-source.port';
import type { IFullLayout, IGraphData } from '../graph-layout';
import { setupSpawnAnchors, type ISpawnAnchorsConfig } from '../spawn-anchors.controller';

function makeDestroyRef(): { ref: DestroyRef; trigger: () => void } {
  let onDestroyCb: (() => void) | null = null;
  const ref = {
    onDestroy(cb: () => void) {
      onDestroyCb = cb;
    },
  } as unknown as DestroyRef;
  return {
    ref,
    trigger: () => onDestroyCb?.(),
  };
}

const EMPTY_LAYOUT: IFullLayout = {
  nodesByPath: new Map(),
  apiNodesByPath: new Map(),
  edges: [],
  positions: new Map(),
  computedAt: 0,
};

const EMPTY_GRAPH: IGraphData = { nodes: [], edges: [] };

function makeConfig(ref: DestroyRef): ISpawnAnchorsConfig {
  return {
    destroyRef: ref,
    agentSpawns: {
      spawnEdges: signal([]),
      sessionNodes: signal([]),
    },
    nodeActivity: { activeInvocations: signal([]) },
    activityStats: { pairCounts: signal<ReadonlyMap<string, number>>(new Map()) },
    livePrefs: { showRuntimeAgents: signal(true) },
    dataSource: {} as IDataSourcePort,
    nodePositions: signal(new Map()),
    fullLayout: signal(EMPTY_LAYOUT),
    mapVisiblePaths: signal(new Set<string>()),
    graph: signal(EMPTY_GRAPH),
    resolveSpawnActiveId: () => null,
  };
}

describe('spawn-anchors.controller', () => {
  it('detaches both in-flight mouseup listeners on destroy', () => {
    const { ref, trigger } = makeDestroyRef();
    const handle = setupSpawnAnchors(makeConfig(ref));
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    // Open both drag gates so their `{ once: true }` listeners are live.
    handle.onSessionPointerDown('owner');
    handle.onAgentCapsulePointerDown('capsule');

    trigger();

    const mouseups = removeSpy.mock.calls.filter((c) => c[0] === 'mouseup');
    expect(mouseups.length).toBe(2);
    removeSpy.mockRestore();
  });

  it('destroyRef.onDestroy is wired so teardown never throws', () => {
    const { ref, trigger } = makeDestroyRef();
    setupSpawnAnchors(makeConfig(ref));
    expect(() => trigger()).not.toThrow();
  });
});
