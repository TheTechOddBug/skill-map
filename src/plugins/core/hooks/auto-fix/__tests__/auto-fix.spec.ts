/**
 * Unit tests for the `core/auto-fix` hook (Decision #144). Cover the
 * manifest contract (ships disabled, subscribes to `job.completed`,
 * filtered to `extensionKind: 'analyzer'`), the dispatcher-level filter
 * (never fires for a non-analyzer job), and the inverse-Modelo-B queueing
 * logic (`on()` resolves matching fixers and `ctx.queue`s each for the
 * node, swallowing a no-findings refusal).
 *
 * The end-to-end wiring (the record path dispatching `job.completed` to
 * this hook with a real `ctx.queue` + `ctx.actions`) is NOT exercised here:
 * that driver wiring is deferred (see the PART 2 report). These tests pin
 * the hook's own behaviour so the wiring only has to supply the context.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { autoFixHook } from '../index.js';
import type {
  IHook,
  IHookActionInfo,
  IHookContext,
} from '../../../../../kernel/extensions/index.js';
import type { Node } from '../../../../../kernel/types.js';
import { makeHookDispatcher } from '../../../../../kernel/extensions/hook-dispatcher.js';
import type { ProgressEmitterPort, ProgressEvent } from '../../../../../kernel/ports/progress-emitter.js';

const NOOP_EMITTER = { emit: () => {} } as unknown as ProgressEmitterPort;

/**
 * Build a `job.completed` hook context for a finder that just closed. The
 * node rides on `ctx.node` (the design the record-path dispatch uses), the
 * finder id on the event payload.
 */
function ctxFor(opts: {
  extensionId?: string;
  nodeId?: string;
  actions?: IHookActionInfo[];
  queue?: (actionId: string, payload: unknown) => void;
}): IHookContext {
  const data: Record<string, unknown> = { extensionKind: 'analyzer' };
  if (opts.extensionId !== undefined) data['extensionId'] = opts.extensionId;
  return {
    settings: {},
    event: { type: 'job.completed', timestamp: new Date().toISOString(), data },
    ...(opts.nodeId !== undefined ? { node: { path: opts.nodeId } as Node } : {}),
    ...(opts.actions !== undefined ? { actions: opts.actions } : {}),
    ...(opts.queue !== undefined ? { queue: opts.queue } : {}),
  };
}

/** A queue spy recording `(actionId, payload)` tuples. */
function queueSpy(): { calls: Array<[string, unknown]>; queue: (a: string, p: unknown) => void } {
  const calls: Array<[string, unknown]> = [];
  return { calls, queue: (a, p) => calls.push([a, p]) };
}

const CONSOLIDATE: IHookActionInfo = {
  id: 'core/node-consolidate',
  analyzerIds: ['core/node-redundancy'],
};
const RECONCILE: IHookActionInfo = {
  id: 'core/node-reconcile',
  analyzerIds: ['core/node-contradiction'],
};
/** A non-fixer Action (no analyzerIds): must never be queued. */
const SUMMARIZER: IHookActionInfo = { id: 'core/markdown-summarizer', analyzerIds: [] };

describe('core/auto-fix hook manifest', () => {
  it('ships disabled (experimental), so auto-editing is opt-in', () => {
    assert.equal(autoFixHook.stability, 'experimental');
  });

  it('subscribes to job.completed, filtered to analyzer completions', () => {
    assert.deepEqual(autoFixHook.triggers, ['job.completed']);
    assert.deepEqual(autoFixHook.filter, { extensionKind: 'analyzer' });
  });
});

describe('core/auto-fix dispatcher filter (extensionKind)', () => {
  /** Wrap the hook with a spy `on` so we can observe whether it fired. */
  function spied(): { fired: boolean; hook: IHook } {
    const state = { fired: false };
    // The built-in manifest omits `version` (the codegen stamps it); add a
    // stub so the shape satisfies the full `IHook` the dispatcher expects.
    const hook: IHook = { ...autoFixHook, version: '0.0.0', on: () => { state.fired = true; } };
    return { get fired() { return state.fired; }, hook };
  }

  function event(extensionKind: string): ProgressEvent {
    return {
      type: 'job.completed',
      timestamp: Date.now(),
      data: { extensionKind, extensionId: 'core/node-redundancy', nodeId: 'n.md' },
    };
  }

  it('does NOT fire for a fixer / action job (extensionKind != analyzer)', async () => {
    const s = spied();
    const dispatcher = makeHookDispatcher([s.hook], NOOP_EMITTER);
    await dispatcher.dispatch('job.completed', event('action'));
    assert.equal(s.fired, false);
  });

  it('fires for a finder (analyzer) job', async () => {
    const s = spied();
    const dispatcher = makeHookDispatcher([s.hook], NOOP_EMITTER);
    await dispatcher.dispatch('job.completed', event('analyzer'));
    assert.equal(s.fired, true);
  });
});

describe('core/auto-fix inverse Modelo B queueing', () => {
  it('queues the matching fixer for the node', () => {
    const spy = queueSpy();
    autoFixHook.on(
      ctxFor({ extensionId: 'core/node-redundancy', nodeId: 'n.md', actions: [CONSOLIDATE, SUMMARIZER], queue: spy.queue }),
    );
    assert.deepEqual(spy.calls, [['core/node-consolidate', { nodeId: 'n.md' }]]);
  });

  it('queues ALL matching fixers when several serve the finder', () => {
    const spy = queueSpy();
    const otherRedundancyFixer: IHookActionInfo = { id: 'plug/dedupe', analyzerIds: ['core/node-redundancy'] };
    autoFixHook.on(
      ctxFor({
        extensionId: 'core/node-redundancy',
        nodeId: 'n.md',
        actions: [CONSOLIDATE, otherRedundancyFixer, RECONCILE],
        queue: spy.queue,
      }),
    );
    assert.deepEqual(
      spy.calls.map((c) => c[0]).sort(),
      ['core/node-consolidate', 'plug/dedupe'],
    );
  });

  it('queues nothing when no fixer serves the finder', () => {
    const spy = queueSpy();
    autoFixHook.on(
      ctxFor({ extensionId: 'core/node-incoherence', nodeId: 'n.md', actions: [CONSOLIDATE, RECONCILE], queue: spy.queue }),
    );
    assert.deepEqual(spy.calls, []);
  });

  it('never queues a non-fixer Action (empty analyzerIds) even on an id match', () => {
    const spy = queueSpy();
    autoFixHook.on(
      ctxFor({ extensionId: 'core/markdown-summarizer', nodeId: 'n.md', actions: [SUMMARIZER], queue: spy.queue }),
    );
    assert.deepEqual(spy.calls, []);
  });

  it('swallows a queue refusal (a fixer with no findings) and keeps going', () => {
    const calls: string[] = [];
    const throwingThenOk = (actionId: string): void => {
      calls.push(actionId);
      if (actionId === 'core/node-consolidate') throw new Error('no findings to resolve');
    };
    const otherRedundancyFixer: IHookActionInfo = { id: 'plug/dedupe', analyzerIds: ['core/node-redundancy'] };
    assert.doesNotThrow(() =>
      autoFixHook.on(
        ctxFor({
          extensionId: 'core/node-redundancy',
          nodeId: 'n.md',
          actions: [CONSOLIDATE, otherRedundancyFixer],
          queue: throwingThenOk,
        }),
      ),
    );
    // Both fixers were attempted; the refusal on the first did not abort the second.
    assert.deepEqual(calls.sort(), ['core/node-consolidate', 'plug/dedupe']);
  });

  it('no-ops (no throw) when the driver did not wire ctx.queue', () => {
    assert.doesNotThrow(() =>
      autoFixHook.on(ctxFor({ extensionId: 'core/node-redundancy', nodeId: 'n.md', actions: [CONSOLIDATE] })),
    );
  });

  it('no-ops when the event carries no node id', () => {
    const spy = queueSpy();
    autoFixHook.on(ctxFor({ extensionId: 'core/node-redundancy', actions: [CONSOLIDATE], queue: spy.queue }));
    assert.deepEqual(spy.calls, []);
  });
});
