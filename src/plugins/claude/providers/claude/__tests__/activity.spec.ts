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
      { kind: 'command', name: 'probe-command', phase: 'start', owner: 'main' },
      { kind: 'skill', name: 'probe-command', phase: 'start', owner: 'main' },
    ]);
  });

  it('UserPromptSubmit is disclaimed (UserPromptExpansion is the command signal)', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'UserPromptSubmit',
      prompt: '/probe-command',
    });
    assert.equal(signals, null);
  });

  it('Skill PreToolUse from the main context maps to a skill signal owned by main', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      hook_event_name: 'PreToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'probe-skill' },
      tool_use_id: 'toolu_015y8G9WHeDyRfLabuUTSoeL',
    });
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'probe-skill', phase: 'start', owner: 'main' },
    ]);
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

  it('Agent PreToolUse (spawn) maps to an agent signal named by subagent_type', () => {
    const signals = claudeActivity.mapEvent({
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
      { kind: 'agent', name: 'probe-agent', phase: 'start', owner: 'main' },
    ]);
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

  it('SubagentStart maps to an agent start owned by its agent_id', () => {
    const signals = claudeActivity.mapEvent({
      session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
      hook_event_name: 'SubagentStart',
      agent_id: 'afa6d56495644b2db',
      agent_type: 'probe-agent',
    });
    assert.deepEqual(signals, [
      { kind: 'agent', name: 'probe-agent', phase: 'start', owner: 'afa6d56495644b2db' },
    ]);
  });

  it('SubagentStop with a matching agent_type maps to an agent end', () => {
    const signals = claudeActivity.mapEvent({
      hook_event_name: 'SubagentStop',
      agent_id: 'afa6d56495644b2db',
      agent_type: 'probe-agent',
      stop_hook_active: false,
      last_assistant_message: 'probe-agent done',
    });
    assert.deepEqual(signals, [
      { kind: 'agent', name: 'probe-agent', phase: 'end', owner: 'afa6d56495644b2db' },
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
