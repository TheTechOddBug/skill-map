/**
 * Antigravity live-activity adapter (`activity.ts`): raw hook payload →
 * activity signals. Payload shapes are REAL captures from the
 * 2026-07-04 live probe (`fixtures/realtime-antigravity/`, agy with
 * gemini-3.5-flash-low): no `hook_event_name` field anywhere, tool
 * events carry `toolCall.{name,args}`, every payload carries
 * `conversationId` + `workspacePaths`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { antigravityActivity } from '../activity.js';

const WORKSPACE = '/home/user/project';
const COMMON = {
  artifactDirectoryPath: '/home/user/.gemini/antigravity-cli/brain/10975125-a914',
  conversationId: '10975125-a914-4b97-8f7c-871ec06e4dfc',
  modelName: 'gemini-3.5-flash-low',
  transcriptPath:
    '/home/user/.gemini/antigravity-cli/brain/10975125-a914/.system_generated/logs/transcript_full.jsonl',
  workspacePaths: [WORKSPACE],
};

describe('antigravityActivity.mapEvent', () => {
  it('declares the named-group descriptor (one view_file event)', () => {
    assert.equal(antigravityActivity.install.kind, 'json-hooks');
    assert.equal(antigravityActivity.install.configPath, '.agents/hooks.json');
    assert.equal(antigravityActivity.install.group, 'skill-map-activity');
    assert.equal(antigravityActivity.install.commandCwd, 'config-dir');
    assert.deepEqual(antigravityActivity.install.events, [
      { event: 'PreToolUse', matcher: 'view_file' },
      { event: 'Stop', entryShape: 'flat' },
    ]);
  });

  it('maps an in-scope markdown view_file to a PATH signal owned by the conversation', () => {
    const signals = antigravityActivity.mapEvent({
      ...COMMON,
      stepIdx: 3,
      toolCall: { args: { AbsolutePath: `${WORKSPACE}/notes/demo.md` }, name: 'view_file' },
    });
    assert.deepEqual(signals, [
      {
        path: 'notes/demo.md',
        phase: 'start',
        owner: '10975125-a914-4b97-8f7c-871ec06e4dfc',
      },
    ]);
  });

  it('a followed workflow lights its .agent/workflows file (real capture)', () => {
    const signals = antigravityActivity.mapEvent({
      ...COMMON,
      conversationId: 'd7f704d7-1111-2222-3333-444455556666',
      stepIdx: 3,
      toolCall: {
        args: { AbsolutePath: `${WORKSPACE}/.agent/workflows/probe-flow.md` },
        name: 'view_file',
      },
    });
    assert.deepEqual(signals, [
      {
        path: '.agent/workflows/probe-flow.md',
        phase: 'start',
        owner: 'd7f704d7-1111-2222-3333-444455556666',
      },
    ]);
  });

  it('filter-first: non-markdown views and out-of-scope paths are disclaimed', () => {
    assert.equal(
      antigravityActivity.mapEvent({
        ...COMMON,
        toolCall: { args: { AbsolutePath: `${WORKSPACE}/src/index.ts` }, name: 'view_file' },
      }),
      null,
    );
    assert.equal(
      antigravityActivity.mapEvent({
        ...COMMON,
        toolCall: { args: { AbsolutePath: '/somewhere/else/readme.md' }, name: 'view_file' },
      }),
      null,
    );
    assert.equal(
      antigravityActivity.mapEvent({
        ...COMMON,
        workspacePaths: [],
        toolCall: { args: { AbsolutePath: `${WORKSPACE}/notes/demo.md` }, name: 'view_file' },
      }),
      null,
    );
  });

  it('disclaims other tools (structural detection, no hook_event_name)', () => {
    const signals = antigravityActivity.mapEvent({
      ...COMMON,
      stepIdx: 2,
      toolCall: { args: { CommandLine: 'cat notes/demo.md' }, name: 'run_command' },
    });
    assert.equal(signals, null);
  });

  it('the conversation Stop maps to a node-less OWNER RELEASE (real capture)', () => {
    const signals = antigravityActivity.mapEvent({
      ...COMMON,
      error: '',
      executionNum: 0,
      fullyIdle: true,
      terminationReason: 'NO_TOOL_CALL',
    });
    assert.deepEqual(signals, [
      { phase: 'end', owner: '10975125-a914-4b97-8f7c-871ec06e4dfc', ownerScope: true },
    ]);
  });

  it('disclaims invocation pulses, tool-less siblings, and malformed payloads', () => {
    // PreInvocation pulse.
    assert.equal(
      antigravityActivity.mapEvent({ ...COMMON, initialNumSteps: 1, invocationNum: 0 }),
      null,
    );
    // PostToolUse sibling with a null toolCall (observed shape).
    assert.equal(
      antigravityActivity.mapEvent({ ...COMMON, error: '', stepIdx: 1, toolCall: null }),
      null,
    );
    // Stop without a conversationId releases nothing.
    assert.equal(
      antigravityActivity.mapEvent({
        workspacePaths: [WORKSPACE],
        terminationReason: 'NO_TOOL_CALL',
      }),
      null,
    );
    assert.equal(antigravityActivity.mapEvent(null), null);
  });
});
