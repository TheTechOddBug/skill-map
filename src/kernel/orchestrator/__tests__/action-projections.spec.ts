/**
 * Coverage for the orchestrator's action-projection pass
 * (`runActionProjections`). An Action that declares a scan-time
 * `project()` emits its own view contributions onto the merged graph
 * during the contribution phase, mirroring the analyzer emit path:
 *
 *   - an action WITH `project` emits its declared button per node, and
 *     the accepted records carry the action's qualified attribution;
 *   - an action WITHOUT `project` is skipped entirely (it only carries
 *     the on-demand `invoke` executor, nothing to project);
 *   - the two emit-time rejection paths hold (undeclared ref → dropped +
 *     `undeclared-contribution-ref`; off-shape payload → dropped + AJV
 *     reason), each firing an `extension.error` event, identical to the
 *     extractor / analyzer emit paths.
 *
 * Driven through the REAL exported `runActionProjections` (no scan
 * harness, no DB) with tiny in-memory action instances.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { runActionProjections } from '../action-projections.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import type { ProgressEvent } from '../../ports/progress-emitter.js';
import type { IAction } from '../../extensions/index.js';
import type { IViewContribution } from '../../types/view-catalog.js';
import type { Node } from '../../types.js';

const GOOD_PAYLOAD = { value: 5 };
const BAD_PAYLOAD = { value: -1 };

function mockNode(path: string): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'core',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function captureErrors(emitter: InMemoryProgressEmitter): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  emitter.subscribe((e) => {
    if (e.type === 'extension.error') events.push(e);
  });
  return events;
}

describe('orchestrator, runActionProjections', () => {
  it('emits a declared contribution per node for an action that declares project()', () => {
    const chip: IViewContribution = { slot: 'card.footer.right', label: 'Chip' };
    const action: IAction = {
      kind: 'action',
      id: 'proj-action',
      pluginId: 'test',
      version: '1.0.0',
      description: 'projection fixture',
      ui: { chip },
      project(ctx): void {
        for (const node of ctx.nodes) ctx.emitContribution(node.path, chip, GOOD_PAYLOAD);
      },
    };

    const emitter = new InMemoryProgressEmitter();
    const errorEvents = captureErrors(emitter);
    const result = runActionProjections([action], [mockNode('a.md'), mockNode('b.md')], [], emitter);

    assert.equal(result.contributions.length, 2, 'one accepted contribution per node');
    assert.equal(result.contributionErrors.length, 0);
    assert.equal(errorEvents.length, 0, 'no rejection events on the happy path');
    const first = result.contributions[0]!;
    assert.equal(first.pluginId, 'test');
    assert.equal(first.extensionId, 'proj-action');
    assert.equal(first.contributionId, 'chip');
    assert.equal(first.slot, 'card.footer.right');
    assert.deepEqual(result.contributions.map((c) => c.nodePath).sort(), ['a.md', 'b.md']);
  });

  it('skips an action with no project() method (invoke-only executor)', () => {
    const invokeOnly: IAction = {
      kind: 'action',
      id: 'invoke-only',
      pluginId: 'test',
      version: '1.0.0',
      description: 'no projection',
      invoke: <TInput, TReport>() => ({ report: {} as TReport }),
    };

    const emitter = new InMemoryProgressEmitter();
    const result = runActionProjections([invokeOnly], [mockNode('a.md')], [], emitter);
    assert.equal(result.contributions.length, 0, 'invoke-only action projects nothing');
    assert.equal(result.contributionErrors.length, 0);
  });

  it('drops undeclared-ref + off-shape emissions, keeps the declared one, fires extension.error', () => {
    const chip: IViewContribution = { slot: 'card.footer.right', label: 'Chip' };
    const action: IAction = {
      kind: 'action',
      id: 'rej-action',
      pluginId: 'test',
      version: '1.0.0',
      description: 'rejection fixture',
      ui: { chip },
      project(ctx): void {
        // (1) declared const, good payload → accepted.
        ctx.emitContribution('a.md', chip, GOOD_PAYLOAD);
        // (2) spread copy → undeclared-ref rejection.
        ctx.emitContribution('a.md', { ...chip }, GOOD_PAYLOAD);
        // (3) declared const, bad payload → off-shape rejection.
        ctx.emitContribution('a.md', chip, BAD_PAYLOAD);
      },
    };

    const emitter = new InMemoryProgressEmitter();
    const errorEvents = captureErrors(emitter);
    const result = runActionProjections([action], [mockNode('a.md')], [], emitter);

    assert.equal(result.contributions.length, 1, 'only the declared-const emission survives');
    const accepted = result.contributions[0]!;
    assert.equal(accepted.extensionId, 'rej-action');
    assert.equal(accepted.contributionId, 'chip');
    assert.deepEqual(accepted.payload, GOOD_PAYLOAD);

    assert.equal(result.contributionErrors.length, 2, 'two rejected emissions');
    const undeclared = result.contributionErrors.find(
      (e) => e.reason === 'undeclared-contribution-ref',
    );
    assert.ok(undeclared, 'undeclared-ref rejection recorded');
    assert.equal(undeclared!.pluginId, 'test');
    assert.equal(undeclared!.extensionId, 'rej-action');
    assert.equal(undeclared!.contributionId, undefined);

    const offShape = result.contributionErrors.find(
      (e) => e.reason !== 'undeclared-contribution-ref',
    );
    assert.ok(offShape, 'off-shape rejection recorded');
    assert.equal(offShape!.contributionId, 'chip');
    assert.equal(offShape!.slot, 'card.footer.right');

    assert.equal(errorEvents.length, 2, 'one extension.error per rejected emission');
    for (const evt of errorEvents) {
      const data = evt.data as Record<string, unknown>;
      assert.equal(data['kind'], 'contribution-rejected');
      assert.equal(data['extensionId'], 'test/rej-action');
      assert.equal(data['phase'], 'emitContribution');
    }
  });
});
