/**
 * `ActivityStatsService` unit tests, pure (no DB, no server boot).
 * Counting semantics are normative in `spec/provider-activity.md`
 * §Execution stats; each case below pins one rule.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ActivityStatsService,
  DISTINCT_OWNERS_CAP,
  STICKY_DEDUPE_CAP,
} from '../activity-stats.js';

const NODE = '.claude/skills/deploy/SKILL.md';

describe('ActivityStatsService.record', () => {
  it('counts a non-sticky start on EVERY signal', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    const second = stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    assert.equal(second?.count, 2);
    assert.equal(second?.distinctOwners, 1);
  });

  it('dedupes sticky starts per (nodePath, owner) pair', () => {
    const stats = new ActivityStatsService();
    const first = stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true });
    assert.equal(first?.count, 1);
    // Same pair again: no recount.
    assert.equal(stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true }), null);
    // Same owner on ANOTHER node is a distinct pair.
    const other = stats.record({
      nodePath: '.claude/agents/worker.md',
      phase: 'start',
      owner: 'a1',
      sticky: true,
    });
    assert.equal(other?.count, 1);
    // A fresh instance (fresh owner id) counts again on the first node.
    const fresh = stats.record({ nodePath: NODE, phase: 'start', owner: 'a2', sticky: true });
    assert.equal(fresh?.count, 2);
  });

  it('a pause/resume sequence (start, ownerScope end, start) counts ONCE', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true });
    // The dedupe memory is append-only: the owner-scoped end does NOT
    // forget the owner, so the resume start below must not recount.
    stats.record({ nodePath: NODE, phase: 'end', owner: 'a1', ownerScope: true });
    assert.equal(stats.record({ nodePath: NODE, phase: 'start', owner: 'a1', sticky: true }), null);
    assert.equal(stats.snapshot()[NODE]?.count, 1);
  });

  it('keepAlive starts never count and never touch the owner set', () => {
    const stats = new ActivityStatsService();
    const custody = stats.record({
      nodePath: NODE,
      phase: 'start',
      owner: 'spawn:t1',
      sticky: true,
      keepAlive: true,
    });
    assert.equal(custody, null);
    assert.deepEqual(stats.snapshot(), {});
    // A later counted start shows no trace of the custody owner.
    const counted = stats.record({ nodePath: NODE, phase: 'start', owner: 'main:s1' });
    assert.equal(counted?.distinctOwners, 1);
  });

  it('ends and node-less owner releases never mutate', () => {
    const stats = new ActivityStatsService();
    assert.equal(stats.record({ nodePath: NODE, phase: 'end', owner: 'a1' }), null);
    assert.equal(stats.record({ phase: 'end', owner: 'a1', ownerScope: true }), null);
    assert.deepEqual(stats.snapshot(), {});
  });

  it('OWNERLESS sticky starts count each time (nothing to dedupe on)', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', sticky: true });
    const second = stats.record({ nodePath: NODE, phase: 'start', sticky: true });
    assert.equal(second?.count, 2);
    assert.equal(second?.distinctOwners, 0);
  });

  it('distinctOwners saturates at the cap', () => {
    const stats = new ActivityStatsService();
    for (let i = 0; i < DISTINCT_OWNERS_CAP + 40; i += 1) {
      stats.record({ nodePath: NODE, phase: 'start', owner: `o${i}` });
    }
    const snap = stats.snapshot()[NODE];
    assert.equal(snap?.count, DISTINCT_OWNERS_CAP + 40);
    assert.equal(snap?.distinctOwners, DISTINCT_OWNERS_CAP);
  });

  it('the sticky dedupe memory evicts oldest-first at its cap', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'first', sticky: true });
    // Fill the memory on another node until the first pair is evicted.
    for (let i = 0; i < STICKY_DEDUPE_CAP; i += 1) {
      stats.record({ nodePath: 'other.md', phase: 'start', owner: `f${i}`, sticky: true });
    }
    // The evicted pair counts again; bounded memory trades a rare
    // recount for never erroring.
    const recounted = stats.record({ nodePath: NODE, phase: 'start', owner: 'first', sticky: true });
    assert.equal(recounted?.count, 2);
  });

  it('lastOwner mirrors the last COUNTED start (absent when ownerless)', () => {
    const stats = new ActivityStatsService();
    stats.record({ nodePath: NODE, phase: 'start', owner: 'a1' });
    assert.equal(stats.snapshot()[NODE]?.lastOwner, 'a1');
    stats.record({ nodePath: NODE, phase: 'start' });
    assert.equal(stats.snapshot()[NODE]?.lastOwner, undefined);
    // A non-counted sticky duplicate does not move it either.
    stats.record({ nodePath: NODE, phase: 'start', owner: 'b1', sticky: true });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'b1', sticky: true });
    assert.equal(stats.snapshot()[NODE]?.lastOwner, 'b1');
  });
});

describe('ActivityStatsService reads', () => {
  it('record() and snapshot() hand out copies (mutations never leak back)', () => {
    const stats = new ActivityStatsService();
    const returned = stats.record({ nodePath: NODE, phase: 'start', owner: 'a1' });
    returned!.count = 999;
    const snap = stats.snapshot();
    assert.equal(snap[NODE]?.count, 1);
    snap[NODE]!.count = 500;
    assert.equal(stats.snapshot()[NODE]?.count, 1);
  });

  it('nodeDetail() returns zeroed stats for an untracked path and copies otherwise', () => {
    const stats = new ActivityStatsService();
    assert.deepEqual(stats.nodeDetail('unknown.md'), {
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
    });
    stats.record({ nodePath: NODE, phase: 'start', owner: 'a1' });
    const detail = stats.nodeDetail(NODE);
    detail.recent[0]!.owner = 'tampered';
    assert.equal(stats.nodeDetail(NODE).recent[0]?.owner, 'a1');
  });

  it('the recent ring is most-recent-first and bounded at 20', () => {
    const stats = new ActivityStatsService();
    for (let i = 0; i < 25; i += 1) {
      stats.record({ nodePath: NODE, phase: 'start', owner: `o${i}` });
    }
    const { recent } = stats.nodeDetail(NODE);
    assert.equal(recent.length, 20);
    assert.equal(recent[0]?.owner, 'o24');
    assert.equal(recent[19]?.owner, 'o5');
    // Monotone timestamps, newest at index 0.
    assert.ok(recent[0]!.at >= recent[19]!.at);
  });

  it('sinceMs is a boot-time unix-ms stamp', () => {
    const before = Date.now();
    const stats = new ActivityStatsService();
    assert.ok(stats.sinceMs >= before);
    assert.ok(stats.sinceMs <= Date.now());
  });
});
