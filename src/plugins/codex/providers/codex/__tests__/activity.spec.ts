/**
 * Codex live-activity adapter (`activity.ts`): raw hook payload →
 * activity signals. Payload shapes follow the official hooks reference
 * (https://developers.openai.com/codex/hooks) cross-checked against the
 * 2026-06-30 live probes (codex 0.142.x): common fields `session_id` /
 * `cwd` / `hook_event_name` / `turn_id`, subagent boundaries carrying
 * `agent_id` + `agent_type`, skill invocations visible ONLY as
 * `$<name>` tokens inside `UserPromptSubmit.prompt`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { codexActivity } from '../activity.js';

const COMMON = {
  session_id: '0d3f7a10-51c2-4f5e-9b1a-2f6d8c4e7a90',
  transcript_path: null,
  cwd: '/home/user/project',
  model: 'gpt-5.5',
  permission_mode: 'default',
  turn_id: 'turn_42',
};

describe('codexActivity.mapEvent', () => {
  it('declares the tight install descriptor (3 events, no tool matchers)', () => {
    assert.equal(codexActivity.install.kind, 'json-hooks');
    assert.equal(codexActivity.install.configPath, '.codex/hooks.json');
    assert.deepEqual(codexActivity.install.events, [
      { event: 'UserPromptSubmit' },
      { event: 'SubagentStart' },
      { event: 'SubagentStop' },
    ]);
  });

  it('maps a $skill prompt to a skill start (sigil stripped, owner main)', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'UserPromptSubmit',
      prompt: '$demo-skill-one run the demo chain',
    });
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'demo-skill-one', phase: 'start', owner: 'main' },
    ]);
  });

  it('emits one signal per DISTINCT token and filters currency / env noise', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'use $deploy and $check-links, budget $100, keep $PATH, then $deploy again',
    });
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'deploy', phase: 'start', owner: 'main' },
      { kind: 'skill', name: 'check-links', phase: 'start', owner: 'main' },
    ]);
  });

  it('disclaims a prompt without any $token', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'just refactor the parser please',
    });
    assert.equal(signals, null);
  });

  it('maps SubagentStart to a sticky agent start keyed by agent_id', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'SubagentStart',
      agent_id: 'agt_7f3c1b',
      agent_type: 'demo-worker',
    });
    assert.deepEqual(signals, [
      { kind: 'agent', name: 'demo-worker', phase: 'start', owner: 'agt_7f3c1b', sticky: true },
    ]);
  });

  it('maps SubagentStop to an owner-scoped agent end', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'SubagentStop',
      agent_id: 'agt_7f3c1b',
      agent_type: 'demo-worker',
      agent_transcript_path: '/tmp/agent-transcript.jsonl',
      stop_hook_active: false,
      last_assistant_message: 'done',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-worker',
        phase: 'end',
        owner: 'agt_7f3c1b',
        ownerScope: true,
      },
    ]);
  });

  it('disclaims subagent boundaries with an empty agent_type', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'SubagentStop',
      agent_id: 'agt_orphan',
      agent_type: '',
    });
    assert.equal(signals, null);
  });

  it('disclaims tool events and everything else (no tool surface is wired)', () => {
    for (const name of ['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop', 'PreCompact']) {
      const signals = codexActivity.mapEvent({
        ...COMMON,
        hook_event_name: name,
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      });
      assert.equal(signals, null, name);
    }
    assert.equal(codexActivity.mapEvent(null), null);
    assert.equal(codexActivity.mapEvent('not-an-object'), null);
  });
});
