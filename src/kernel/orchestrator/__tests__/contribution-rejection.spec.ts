/**
 * Orchestrator emit-time rejection paths for `ctx.emitContribution`.
 *
 * `ctx.emitContribution` takes the contribution OBJECT by reference; the
 * kernel recovers its id + slot from the extension's `ui` map by object
 * identity (`readDeclaredContributionRefs` → `Map.get`, SameValueZero).
 * Two rejection paths must hold for BOTH the Extractor emit
 * (`runExtractorsForNode`) and the Analyzer emit (`runAnalyzers`):
 *
 *   1. **undeclared ref**, the emitted object is NOT one of the declared
 *      `ui` values (a spread copy `{ ...declared }`, an inline literal).
 *      The emission is dropped (absent from the returned `contributions`),
 *      a `contributionErrors` record with `reason:
 *      'undeclared-contribution-ref'` is appended, and an
 *      `extension.error` event fires on the emitter.
 *   2. **off-shape payload**, a declared ref but a payload that fails the
 *      slot's AJV schema. Dropped, a `contributionErrors` record carrying
 *      the AJV error `reason` + `contributionId` + `slot`, and an
 *      `extension.error` event fires.
 *
 * Driven through the REAL exported orchestrator functions (no scan
 * harness, no DB), so the fixtures are tiny in-memory extension
 * instances. A declared-const-with-good-payload emission rides alongside
 * each rejection to prove the happy path still lands in `contributions`.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { runExtractorsForNode } from '../extractors.js';
import { runAnalyzers } from '../analyzers.js';
import { makeHookDispatcher } from '../../extensions/hook-dispatcher.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import type { ProgressEvent } from '../../ports/progress-emitter.js';
import type { IAnalyzer, IExtractor } from '../../extensions/index.js';
import type { IViewContribution } from '../../types/view-catalog.js';
import type { Node } from '../../types.js';

// `card.footer.right` carries the shared `_counter` payload
// (`{ value: number >= 0 }`). `{ value: 5 }` validates; `{ value: -1 }`
// fails the `minimum: 0` constraint (mirrors the AJV unit test in
// `__tests__/integration/view-contributions.spec.ts`).
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

/** Subscribe before running and collect every `extension.error` event. */
function captureErrors(emitter: InMemoryProgressEmitter): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  emitter.subscribe((e) => {
    if (e.type === 'extension.error') events.push(e);
  });
  return events;
}

describe('orchestrator, emitContribution rejection (extractor)', () => {
  it('drops undeclared-ref + off-shape emissions, keeps the declared one, fires extension.error', async () => {
    // Declared const, the only object the kernel will recognise by
    // identity. Passing a spread copy or an inline literal must reject.
    const facts: IViewContribution = { slot: 'card.footer.right', label: 'Facts' };

    const extractor: IExtractor = {
      kind: 'extractor',
      id: 'rej-extractor',
      pluginId: 'test',
      version: '1.0.0',
      description: 'rejection fixture',
      scope: 'body',
      ui: { facts },
      extract(ctx): void {
        // (1) declared const, good payload → accepted.
        ctx.emitContribution(facts, GOOD_PAYLOAD);
        // (2) spread copy of the declared const → not the same object,
        //     undeclared-ref rejection.
        ctx.emitContribution({ ...facts }, GOOD_PAYLOAD);
        // (3) declared const, payload that fails the slot schema →
        //     off-shape rejection.
        ctx.emitContribution(facts, BAD_PAYLOAD);
      },
    };

    const emitter = new InMemoryProgressEmitter();
    const errorEvents = captureErrors(emitter);
    const node = mockNode('a.md');

    const result = await runExtractorsForNode({
      extractors: [extractor],
      node,
      body: 'body',
      frontmatter: {},
      bodyHash: 'c'.repeat(64),
      emitter,
    });

    // Only the declared-const-with-good-payload emission survives.
    assert.equal(result.contributions.length, 1, 'exactly one accepted contribution');
    const accepted = result.contributions[0]!;
    assert.equal(accepted.pluginId, 'test');
    assert.equal(accepted.extensionId, 'rej-extractor');
    assert.equal(accepted.contributionId, 'facts');
    assert.equal(accepted.slot, 'card.footer.right');
    assert.equal(accepted.nodePath, 'a.md');
    assert.deepEqual(accepted.payload, GOOD_PAYLOAD);

    // Two rejections recorded in the error buffer.
    assert.equal(result.contributionErrors.length, 2, 'two rejected emissions');

    const undeclared = result.contributionErrors.find(
      (e) => e.reason === 'undeclared-contribution-ref',
    );
    assert.ok(undeclared, 'undeclared-ref rejection recorded');
    assert.equal(undeclared!.pluginId, 'test');
    assert.equal(undeclared!.extensionId, 'rej-extractor');
    assert.equal(undeclared!.nodePath, 'a.md');
    // The undeclared-ref shape never resolves a target slot / id.
    assert.equal(undeclared!.contributionId, undefined);
    assert.equal(undeclared!.slot, undefined);

    const offShape = result.contributionErrors.find(
      (e) => e.reason !== 'undeclared-contribution-ref',
    );
    assert.ok(offShape, 'off-shape rejection recorded');
    assert.equal(offShape!.contributionId, 'facts', 'AJV failure resolves the target id');
    assert.equal(offShape!.slot, 'card.footer.right', 'AJV failure resolves the target slot');
    assert.ok(offShape!.reason.length > 0, 'reason carries the AJV error string');
    assert.notEqual(offShape!.reason, 'undeclared-contribution-ref');

    // One `extension.error` event per rejection (the accepted emission
    // fires none).
    assert.equal(errorEvents.length, 2, 'one extension.error per rejected emission');
    for (const evt of errorEvents) {
      const data = evt.data as Record<string, unknown>;
      assert.equal(data['kind'], 'contribution-rejected');
      assert.equal(data['extensionId'], 'test/rej-extractor');
      assert.equal(data['phase'], 'emitContribution');
      assert.equal(data['nodePath'], 'a.md');
    }
    const reasons = errorEvents.map((e) => (e.data as Record<string, unknown>)['reason']);
    assert.ok(
      reasons.includes('undeclared-contribution-ref'),
      'an undeclared-ref event fired',
    );
  });
});

describe('orchestrator, emitContribution rejection (analyzer)', () => {
  it('drops undeclared-ref + off-shape emissions, keeps the declared one, fires extension.error', async () => {
    const tag: IViewContribution = { slot: 'card.footer.right', label: 'Tag' };

    const analyzer: IAnalyzer = {
      kind: 'analyzer',
      id: 'rej-analyzer',
      pluginId: 'test',
      version: '1.0.0',
      description: 'rejection fixture',
      ui: { tag },
      // Analyzers see the full graph and supply nodePath explicitly.
      evaluate(ctx) {
        // (1) declared const, good payload → accepted.
        ctx.emitContribution!('a.md', tag, GOOD_PAYLOAD);
        // (2) spread copy → undeclared-ref rejection.
        ctx.emitContribution!('a.md', { ...tag }, GOOD_PAYLOAD);
        // (3) declared const, bad payload → off-shape rejection.
        ctx.emitContribution!('a.md', tag, BAD_PAYLOAD);
        return [];
      },
    };

    const emitter = new InMemoryProgressEmitter();
    const errorEvents = captureErrors(emitter);

    const result = await runAnalyzers(
      [analyzer],
      [mockNode('a.md')],
      [], // internalLinks
      [], // orphanSidecars
      new Map(), // sidecarRoots
      [], // annotationContributions
      [], // viewContributions
      undefined, // referenceablePaths
      undefined, // cwd
      new Set<string>(), // registeredActionIds
      emitter,
      makeHookDispatcher([], emitter),
      undefined, // reservedNodePaths
      undefined, // brokenLinks
      undefined, // nameCollisions
      undefined, // signals
      undefined, // nameMismatches
    );

    // Only the declared-const-with-good-payload emission survives.
    assert.equal(result.contributions.length, 1, 'exactly one accepted contribution');
    const accepted = result.contributions[0]!;
    assert.equal(accepted.pluginId, 'test');
    assert.equal(accepted.extensionId, 'rej-analyzer');
    assert.equal(accepted.contributionId, 'tag');
    assert.equal(accepted.slot, 'card.footer.right');
    assert.equal(accepted.nodePath, 'a.md');
    assert.deepEqual(accepted.payload, GOOD_PAYLOAD);

    // The analyzer emits no issues; assert the rule path stayed clean.
    assert.deepEqual(result.issues, []);

    // Two rejections recorded.
    assert.equal(result.contributionErrors.length, 2, 'two rejected emissions');

    const undeclared = result.contributionErrors.find(
      (e) => e.reason === 'undeclared-contribution-ref',
    );
    assert.ok(undeclared, 'undeclared-ref rejection recorded');
    assert.equal(undeclared!.pluginId, 'test');
    assert.equal(undeclared!.extensionId, 'rej-analyzer');
    assert.equal(undeclared!.nodePath, 'a.md');
    assert.equal(undeclared!.contributionId, undefined);
    assert.equal(undeclared!.slot, undefined);

    const offShape = result.contributionErrors.find(
      (e) => e.reason !== 'undeclared-contribution-ref',
    );
    assert.ok(offShape, 'off-shape rejection recorded');
    assert.equal(offShape!.contributionId, 'tag', 'AJV failure resolves the target id');
    assert.equal(offShape!.slot, 'card.footer.right', 'AJV failure resolves the target slot');
    assert.ok(offShape!.reason.length > 0, 'reason carries the AJV error string');
    assert.notEqual(offShape!.reason, 'undeclared-contribution-ref');

    // One `extension.error` event per rejection.
    assert.equal(errorEvents.length, 2, 'one extension.error per rejected emission');
    for (const evt of errorEvents) {
      const data = evt.data as Record<string, unknown>;
      assert.equal(data['kind'], 'contribution-rejected');
      assert.equal(data['extensionId'], 'test/rej-analyzer');
      assert.equal(data['phase'], 'emitContribution');
      assert.equal(data['nodePath'], 'a.md');
    }
    const reasons = errorEvents.map((e) => (e.data as Record<string, unknown>)['reason']);
    assert.ok(
      reasons.includes('undeclared-contribution-ref'),
      'an undeclared-ref event fired',
    );
  });
});
