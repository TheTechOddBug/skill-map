/**
 * Capture-level ladder unit tests (`server/capture-level.ts`, contract
 * in `spec/provider-activity.md` §Capture level): the cumulative rank
 * order, the resolved-frame classifier, and the live cell's gate.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  CAPTURE_LEVELS,
  CaptureLevelState,
  DEFAULT_CAPTURE_LEVEL,
  activityFrameRank,
  captureLevelRank,
  isCaptureLevel,
} from '../capture-level.js';
import type { INodeActivityEventData } from '../events.js';

function frame(over: Partial<INodeActivityEventData>): INodeActivityEventData {
  return { phase: 'start', nodePath: 'a.md', owner: 'main:s1', ...over };
}

describe('capture-level ladder', () => {
  it('ranks the ladder cumulatively in spec order', () => {
    const ranks = CAPTURE_LEVELS.map(captureLevelRank);
    assert.deepEqual(ranks, [1, 2, 3, 4, 5]);
    assert.equal(DEFAULT_CAPTURE_LEVEL, 'mcp');
  });

  it('recognises only ladder names', () => {
    for (const level of CAPTURE_LEVELS) assert.equal(isCaptureLevel(level), true);
    assert.equal(isCaptureLevel('everything'), false);
    assert.equal(isCaptureLevel(4), false);
  });

  it('classifies resolved frames: no access = the executions floor, access = its class', () => {
    assert.equal(activityFrameRank(frame({})), 1);
    // Custody / lifecycle / session bounds carry no access: floor too.
    assert.equal(activityFrameRank(frame({ keepAlive: true })), 1);
    assert.equal(activityFrameRank(frame({ phase: 'end', turnEnd: true })), 1);
    assert.equal(activityFrameRank(frame({ access: 'read' })), 2);
    assert.equal(activityFrameRank(frame({ access: 'write' })), 3);
    assert.equal(activityFrameRank(frame({ access: 'mcp' })), 4);
    assert.equal(activityFrameRank(frame({ access: 'shell' })), 5);
  });

  it('the live cell gates frames above its level and moves live', () => {
    const state = new CaptureLevelState('executions');
    assert.equal(state.passes(frame({})), true);
    assert.equal(state.passes(frame({ access: 'read' })), false);
    assert.equal(state.passes(frame({ access: 'write' })), false);
    assert.equal(state.passes(frame({ access: 'mcp' })), false);

    state.set('reads');
    assert.equal(state.passes(frame({ access: 'read' })), true);
    assert.equal(state.passes(frame({ access: 'write' })), false);

    state.set('mcp');
    assert.equal(state.passes(frame({ access: 'mcp' })), true);
    // The default rung keeps shell sightings out; only rung 5 admits them.
    assert.equal(state.passes(frame({ access: 'shell' })), false);
    assert.equal(state.current(), 'mcp');

    state.set('shell');
    assert.equal(state.passes(frame({ access: 'shell' })), true);
  });
});
