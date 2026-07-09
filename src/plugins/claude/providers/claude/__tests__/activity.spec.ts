/**
 * `claudeActivity.mapEvent` unit tests.
 *
 * Every payload below is a REAL Claude Code hook payload captured by the
 * live activity probes (2026-06-29/30, `.tmp/activity-probe/claude/`),
 * trimmed to the fields the mapper reads plus enough context to stay
 * recognisably real. The mapper must be total over arbitrary input (the
 * bridge forwards whatever the runtime emits), so the garbage cases are
 * as load-bearing as the happy paths.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { claudeActivity } from '../activity.js';

describe('claudeActivity.mapEvent', () => {
  it('slash expansion yields BOTH command and skill signals (shared / namespace)', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      cwd: '/home/user/project',
      permission_mode: 'default',
      hook_event_name: 'UserPromptExpansion',
      expansion_type: 'slash_command',
      command_name: 'probe-command',
      command_args: '',
      command_source: 'projectSettings',
      prompt: '/probe-command',
    });
    assert.deepEqual(signals, [
      {
        kind: 'command',
        name: 'probe-command',
        phase: 'start',
        owner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
      },
      {
        kind: 'skill',
        name: 'probe-command',
        phase: 'start',
        owner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
      },
    ]);
  });

  it('UserPromptSubmit is disclaimed (UserPromptExpansion is the command signal)', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'UserPromptSubmit',
      prompt: '/probe-command',
    });
    assert.equal(signals, null);
  });

  it('Skill PreToolUse from the main context is owned by the SESSIONIZED main key', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      hook_event_name: 'PreToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'probe-skill' },
      tool_use_id: 'toolu_015y8G9WHeDyRfLabuUTSoeL',
    });
    assert.deepEqual(signals, [
      {
        kind: 'skill',
        name: 'probe-skill',
        phase: 'start',
        owner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
      },
    ]);
  });

  it('falls back to the bare `main` owner when the payload carries no session_id', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PreToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'probe-skill' },
      tool_use_id: 'toolu_015y8G9WHeDyRfLabuUTSoeL',
    });
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'probe-skill', phase: 'start', owner: 'main' },
    ]);
  });

  it('an MCP tool PreToolUse yields a PATH signal to the mcp:// node (same id as the static edge)', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__images__search',
      tool_input: { query: 'art' },
      tool_use_id: 'toolu_x',
    });
    assert.deepEqual(signals, [
      {
        path: 'mcp://images',
        phase: 'start',
        owner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
        detail: 'search',
      },
    ]);
  });

  it('a non-MCP, non-attributable tool (Bash) is disclaimed', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });
    assert.equal(signals, null);
  });

  it('Skill PreToolUse fired INSIDE a subagent is owned by that agent_id', () => {
    // Depth-4 nesting run: the deepest subagent (probe-l4) invoked the
    // skill; the event arrives stamped with its agent identity.
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PreToolUse',
      agent_id: 'ad21876e2d1c4e17b',
      agent_type: 'probe-l4',
      tool_name: 'Skill',
      tool_input: { skill: 'probe-skill' },
      tool_use_id: 'toolu_0158hBapyGGoYs9rFRJgKh5g',
    });
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'probe-skill', phase: 'start', owner: 'ad21876e2d1c4e17b' },
    ]);
  });

  it('a spawn from MAIN emits the RELATION-ONLY form (main is not a node to keep lit)', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_input: {
        description: 'Run probe agent',
        prompt: 'Ejecuta la tarea de prueba del probe-agent.',
        subagent_type: 'probe-agent',
      },
      tool_use_id: 'toolu_01Hs3r6xww87USRS7FjNrYyv',
    });
    assert.deepEqual(signals, [
      {
        phase: 'start',
        owner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
        spawn: {
          spawnId: 'toolu_01Hs3r6xww87USRS7FjNrYyv',
          phase: 'start',
          parentOwner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
          childKind: 'agent',
          childName: 'probe-agent',
          prompt: 'Ejecuta la tarea de prueba del probe-agent.',
        },
      },
    ]);
  });

  it('a spawn completion from MAIN emits a RELATION-ONLY handoff/end (no custody to move)', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_input: { prompt: 'run it', subagent_type: 'probe-agent' },
      tool_response: {
        isAsync: true,
        status: 'async_launched',
        agentId: 'afa6d56495644b2db',
      },
      tool_use_id: 'toolu_01Hs3r6xww87USRS7FjNrYyv',
    });
    assert.deepEqual(signals, [
      {
        phase: 'end',
        owner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
        spawn: {
          spawnId: 'toolu_01Hs3r6xww87USRS7FjNrYyv',
          phase: 'handoff',
          parentOwner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
          childKind: 'agent',
          childName: 'probe-agent',
          childOwner: 'afa6d56495644b2db',
        },
      },
    ]);
  });

  it('a spawn from an AGENT starts parent custody (sticky keep-alive, spawn relation)', () => {
    // Claude PAUSES a spawning parent (non-terminal SubagentStop), so
    // the spawn itself keeps the parent lit via a synthetic owner the
    // PostToolUse handoff later releases. keepAlive excludes the claim
    // from execution counting; the spawn block carries the relation.
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PreToolUse',
      agent_id: 'a4e825faeafee3619',
      agent_type: 'demo-orchestrator',
      tool_name: 'Agent',
      tool_input: { prompt: 'continue the chain', subagent_type: 'demo-worker' },
      tool_use_id: 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-orchestrator',
        phase: 'start',
        owner: 'spawn:toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
        sticky: true,
        keepAlive: true,
        spawn: {
          spawnId: 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
          phase: 'start',
          parentOwner: 'a4e825faeafee3619',
          childKind: 'agent',
          childName: 'demo-worker',
          prompt: 'continue the chain',
        },
      },
    ]);
  });

  it('the spawn PostToolUse hands custody from the spawn key to the child id', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PostToolUse',
      agent_id: 'a4e825faeafee3619',
      agent_type: 'demo-orchestrator',
      tool_name: 'Agent',
      tool_input: { prompt: 'continue the chain', subagent_type: 'demo-worker' },
      tool_response: {
        isAsync: true,
        status: 'async_launched',
        agentId: 'abb6b017ce54ffcdf',
      },
      tool_use_id: 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-orchestrator',
        phase: 'end',
        owner: 'spawn:toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
        ownerScope: true,
        spawn: {
          spawnId: 'toolu_01MEQBSdHNo3B9pMjY8s7ZQK',
          phase: 'handoff',
          parentOwner: 'a4e825faeafee3619',
          childKind: 'agent',
          childName: 'demo-worker',
          childOwner: 'abb6b017ce54ffcdf',
        },
      },
      {
        kind: 'agent',
        name: 'demo-orchestrator',
        phase: 'start',
        owner: 'abb6b017ce54ffcdf',
        sticky: true,
        keepAlive: true,
      },
    ]);
  });

  it('a COMPLETED spawn PostToolUse never hands custody to the (dead) child', () => {
    // Real payload (fixtures/realtime run, 2026-07-04): the runtime fired
    // this PostToolUse ~66ms AFTER the child's terminal SubagentStop, so
    // a child-owned claim here would be an orphan nothing releases. Only
    // `status: 'async_launched'` (child still running) hands custody.
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PostToolUse',
      agent_id: 'a39dff5df12ce5900',
      agent_type: 'demo-orchestrator',
      tool_name: 'Agent',
      tool_input: { prompt: 'continue the chain', subagent_type: 'demo-worker' },
      tool_response: {
        agentId: 'abc65c6e81818dfd1',
        status: 'completed',
      },
      tool_use_id: 'toolu_019tAnpkqUttxYed3ZWyecWX',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-orchestrator',
        phase: 'end',
        owner: 'spawn:toolu_019tAnpkqUttxYed3ZWyecWX',
        ownerScope: true,
        spawn: {
          spawnId: 'toolu_019tAnpkqUttxYed3ZWyecWX',
          phase: 'end',
          parentOwner: 'a39dff5df12ce5900',
          childKind: 'agent',
          childName: 'demo-worker',
        },
      },
    ]);
  });

  it('a SYNC spawn PostToolUse releases custody and carries the string response', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PostToolUse',
      agent_id: 'a4e825faeafee3619',
      agent_type: 'demo-orchestrator',
      tool_name: 'Agent',
      tool_input: { prompt: 'continue', subagent_type: 'demo-worker' },
      tool_response: 'child final report text',
      tool_use_id: 'toolu_01SyncSpawnExample000001',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-orchestrator',
        phase: 'end',
        owner: 'spawn:toolu_01SyncSpawnExample000001',
        ownerScope: true,
        spawn: {
          spawnId: 'toolu_01SyncSpawnExample000001',
          phase: 'end',
          parentOwner: 'a4e825faeafee3619',
          childKind: 'agent',
          childName: 'demo-worker',
          response: 'child final report text',
        },
      },
    ]);
  });

  it('an in-scope markdown Read maps to a PATH signal (scope-relative)', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      cwd: '/home/user/project',
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/project/notes/todo.md' },
      tool_use_id: 'toolu_01ReadMarkdownExample0001',
    });
    assert.deepEqual(signals, [
      {
        path: 'notes/todo.md',
        phase: 'start',
        owner: 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be',
      },
    ]);
  });

  it('a markdown Read inside a subagent is owned by that agent_id', () => {
    const signals = claudeActivity.mapEvent({
      cwd: '/home/user/project',
      hook_event_name: 'PreToolUse',
      agent_id: 'afa6d56495644b2db',
      agent_type: 'probe-agent',
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/project/docs/playbook.md' },
    });
    assert.deepEqual(signals, [
      { path: 'docs/playbook.md', phase: 'start', owner: 'afa6d56495644b2db' },
    ]);
  });

  it('Read filter: early-disclaims everything that can never light a node', () => {
    const base = {
      cwd: '/home/user/project',
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
    };
    // Not a markdown file (the high-frequency case: source code reads).
    assert.equal(
      claudeActivity.mapEvent({ ...base, tool_input: { file_path: '/home/user/project/src/index.ts' } }),
      null,
    );
    // Outside the scope root: cannot be a scanned node of this project.
    assert.equal(
      claudeActivity.mapEvent({ ...base, tool_input: { file_path: '/somewhere/else/readme.md' } }),
      null,
    );
    // No usable cwd on the event.
    assert.equal(
      claudeActivity.mapEvent({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/home/user/project/notes/todo.md' },
      }),
      null,
    );
    // Missing / empty file_path.
    assert.equal(claudeActivity.mapEvent({ ...base, tool_input: {} }), null);
  });

  it('plain tool calls are disclaimed (tools are not graph nodes)', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PreToolUse',
      agent_id: 'afa6d56495644b2db',
      agent_type: 'probe-agent',
      tool_name: 'Bash',
      tool_input: { command: 'echo probe-agent-ran' },
      tool_use_id: 'toolu_01DSH9vTxxHAMnVhFZNSguDu',
    });
    assert.equal(signals, null);
  });

  it('SubagentStart maps to a STICKY agent start owned by its agent_id', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      hook_event_name: 'SubagentStart',
      agent_id: 'afa6d56495644b2db',
      agent_type: 'probe-agent',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'probe-agent',
        phase: 'start',
        owner: 'afa6d56495644b2db',
        sticky: true,
      },
    ]);
  });

  it('SubagentStop maps to an OWNER-SCOPED agent end (its whole context goes dark)', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'SubagentStop',
      agent_id: 'afa6d56495644b2db',
      agent_type: 'probe-agent',
      stop_hook_active: false,
      last_assistant_message: 'probe-agent done',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'probe-agent',
        phase: 'end',
        owner: 'afa6d56495644b2db',
        ownerScope: true,
        report: 'probe-agent done',
      },
    ]);
  });

  it('orphan SubagentStop (empty agent_type) is disclaimed', () => {
    // Observed live: SubagentStop fires out of order with an empty
    // agent_type and an unrelated agent_id; treating it as an end
    // would darken a node that is still running.
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'SubagentStop',
      agent_id: 'a53bffefb963baff2',
      agent_type: '',
      stop_hook_active: false,
    });
    assert.equal(signals, null);
  });

  it('a sync completion with content blocks joins the text as the response', () => {
    // Current runtimes ship tool_response as { content: [{type,text}] }
    // (live-observed 2026-07-05); older payloads were a plain string.
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PostToolUse',
      agent_id: 'a4e825faeafee3619',
      agent_type: 'demo-orchestrator',
      tool_name: 'Agent',
      tool_input: { prompt: 'continue', subagent_type: 'demo-worker' },
      tool_response: {
        status: 'completed',
        content: [
          { type: 'text', text: 'first block' },
          { type: 'tool_use', id: 'ignored' },
          { type: 'text', text: 'second block' },
        ],
      },
      tool_use_id: 'toolu_01BlockResponse00000001',
    });
    assert.equal(signals![0]!.spawn?.response, 'first block\nsecond block');
    assert.equal(signals![0]!.spawn?.phase, 'end');
  });

  it('a sync completion with totals carries the execution summary', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'PostToolUse',
      agent_id: 'a4e825faeafee3619',
      agent_type: 'demo-orchestrator',
      tool_name: 'Agent',
      tool_input: { prompt: 'continue', subagent_type: 'demo-worker' },
      tool_response: {
        status: 'completed',
        content: [{ type: 'text', text: 'done' }],
        totalDurationMs: 27219,
        totalTokens: 4132,
        totalToolUseCount: 6,
      },
      tool_use_id: 'toolu_01ExecSummary0000000001',
    });
    assert.deepEqual(signals![0]!.spawn?.execution, {
      durationMs: 27219,
      tokens: 4132,
      toolUses: 6,
    });
    // Garbage numbers are skipped; a summary with nothing usable disclaims.
    const garbage = claudeActivity.mapEvent({
      hook_event_name: 'PostToolUse',
      agent_type: 'demo-orchestrator',
      tool_name: 'Agent',
      tool_input: { subagent_type: 'demo-worker' },
      tool_response: { status: 'completed', totalTokens: 'many', totalDurationMs: null },
      tool_use_id: 'toolu_01ExecSummary0000000002',
    });
    assert.equal(garbage![0]!.spawn?.execution, undefined);
  });

  it('a terminal SubagentStop carries the final message as the report', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'SubagentStop',
      agent_id: 'a5f3314eeca465a2f',
      agent_type: 'demo-orchestrator',
      last_assistant_message: 'final report text',
      agent_transcript_path: '/home/user/.claude/projects/x/agent-a5f.jsonl',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-orchestrator',
        phase: 'end',
        owner: 'a5f3314eeca465a2f',
        ownerScope: true,
        report: 'final report text',
      },
    ]);
    // A start never carries one, and a stop without the field stays bare.
    const bare = claudeActivity.mapEvent({
      hook_event_name: 'SubagentStop',
      agent_id: 'a5f3314eeca465a2f',
      agent_type: 'demo-orchestrator',
    });
    assert.equal(bare![0]!.report, undefined);
  });

  it('session-level events and garbage are disclaimed', () => {
    assert.equal(claudeActivity.mapEvent({ hook_event_name: 'Stop', stop_hook_active: false }), null);
    assert.equal(claudeActivity.mapEvent({ hook_event_name: 'SessionEnd', reason: 'other' }), null);
    assert.equal(claudeActivity.mapEvent(null), null);
    assert.equal(claudeActivity.mapEvent('not an object'), null);
    assert.equal(claudeActivity.mapEvent({}), null);
    assert.equal(
      claudeActivity.mapEvent({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: {} }),
      null,
    );
  });
});
