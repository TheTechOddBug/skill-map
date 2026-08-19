/**
 * Mapper digest store (see `spec/provider-activity.md` §Mapper digest).
 *
 * The load-bearing properties, in order of how much damage getting them
 * wrong would do:
 *   - PRIVACY: the digest records schema, never content. No payload
 *     value survives except the two vendor discriminators the ingest log
 *     is already allowed to log.
 *   - a `resolved` ingest counts toward the totals and records NO shape
 *     (a shape entry is only ever a question about why nothing came out).
 *   - identical shapes collapse and count; distinct ones do not.
 *   - the ring is bounded and evicts oldest-first.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ActivityDisclaimedStore } from '../activity-disclaimed.js';

/** A claude-dialect payload carrying content in every value position. */
const SECRET = 'super-secret-value';

function payload(): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'read',
    session_id: SECRET,
    tool_input: { path: SECRET, offset: 1 },
    matches: [{ leaked: SECRET }],
  };
}

describe('mapper digest store', () => {
  it('records key NAMES and the two discriminators, never a value', () => {
    const store = new ActivityDisclaimedStore();
    store.record('claude', 'no-signals', payload());

    const report = store.report('claude')[0]!;
    assert.equal(report.received, 1);
    assert.equal(report.resolved, 0);
    assert.equal(report.shapes.length, 1);

    const shape = report.shapes[0]!;
    assert.equal(shape.outcome, 'no-signals');
    assert.equal(shape.hook, 'PreToolUse');
    assert.equal(shape.tool, 'read');
    // Depth two, dotted, arrays never descended into.
    assert.ok(shape.keys.includes('tool_input.path'));
    assert.ok(shape.keys.includes('tool_input.offset'));
    assert.ok(!shape.keys.some((k) => k.startsWith('matches.')));

    // The privacy invariant, asserted over the WHOLE serialized entry so
    // a future field cannot quietly open a content channel.
    assert.ok(!JSON.stringify(shape).includes(SECRET));
  });

  it('counts a resolved ingest without recording a shape', () => {
    const store = new ActivityDisclaimedStore();
    store.record('claude', 'resolved', payload());

    const report = store.report('claude')[0]!;
    assert.equal(report.received, 1);
    assert.equal(report.resolved, 1);
    assert.deepEqual(report.shapes, []);
  });

  it('collapses identical shapes and keeps distinct ones apart', () => {
    const store = new ActivityDisclaimedStore();
    store.record('claude', 'no-signals', payload());
    store.record('claude', 'no-signals', payload());
    store.record('claude', 'no-signals', { ...payload(), tool_name: 'write' });

    const report = store.report('claude')[0]!;
    assert.equal(report.received, 3);
    assert.equal(report.shapes.length, 2);
    // Loudest first, so the operator reads the dominant failure at the top.
    assert.equal(report.shapes[0]!.tool, 'read');
    assert.equal(report.shapes[0]!.count, 2);
    assert.equal(report.shapes[1]!.count, 1);
  });

  it('finds a tool name nested one level in (the opencode dialect)', () => {
    const store = new ActivityDisclaimedStore();
    store.record('opencode', 'no-signals', { hook: 'tool.execute.before', input: { tool: 'read' } });

    const report = store.report('opencode')[0]!;
    assert.equal(report.shapes[0]!.hook, 'tool.execute.before');
    assert.equal(report.shapes[0]!.tool, 'read');
  });

  it('reports an unknown provider as zeroed rather than absent', () => {
    const store = new ActivityDisclaimedStore();
    assert.deepEqual(store.report('never-seen'), [
      { id: 'never-seen', received: 0, resolved: 0, shapes: [] },
    ]);
  });

  it('bounds the ring and evicts oldest-first', () => {
    const store = new ActivityDisclaimedStore(2);
    store.record('claude', 'no-signals', { hook_event_name: 'A' });
    store.record('claude', 'no-signals', { hook_event_name: 'B' });
    store.record('claude', 'no-signals', { hook_event_name: 'C' });

    const report = store.report('claude')[0]!;
    assert.equal(report.received, 3);
    assert.equal(report.shapes.length, 2);
    assert.deepEqual(
      report.shapes.map((s) => s.hook).sort(),
      ['B', 'C'],
    );
  });

  it('reports every provider seen when none is named', () => {
    const store = new ActivityDisclaimedStore();
    store.record('claude', 'no-signals', payload());
    store.record('codex', 'resolved', payload());

    const ids = store.report().map((r) => r.id).sort();
    assert.deepEqual(ids, ['claude', 'codex']);
  });
});
