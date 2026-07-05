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
  it('declares the tight install descriptor (spawn tool matcher-scoped)', () => {
    assert.equal(codexActivity.install.kind, 'json-hooks');
    assert.equal(codexActivity.install.configPath, '.codex/hooks.json');
    assert.deepEqual(codexActivity.install.events, [
      { event: 'UserPromptSubmit' },
      { event: 'PreToolUse', matcher: '^spawn_agent$' },
      { event: 'PostToolUse', matcher: '^spawn_agent$' },
      { event: 'SubagentStart' },
      { event: 'SubagentStop' },
    ]);
  });

  it('maps a $skill prompt to a skill start (sigil stripped, sessionized main owner)', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'UserPromptSubmit',
      prompt: '$demo-skill-one run the demo chain',
    });
    assert.deepEqual(signals, [
      {
        kind: 'skill',
        name: 'demo-skill-one',
        phase: 'start',
        owner: 'main:0d3f7a10-51c2-4f5e-9b1a-2f6d8c4e7a90',
      },
    ]);
  });

  it('falls back to the bare `main` owner when the payload carries no session_id', () => {
    const { session_id: _sessionId, ...noSession } = COMMON;
    const signals = codexActivity.mapEvent({
      ...noSession,
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
    const owner = 'main:0d3f7a10-51c2-4f5e-9b1a-2f6d8c4e7a90';
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'deploy', phase: 'start', owner },
      { kind: 'skill', name: 'check-links', phase: 'start', owner },
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
        report: 'done',
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

  it('disclaims non-spawn tool events and everything else', () => {
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

  it('a MAIN spawn_agent start emits the relation-only form with prompt (real 2026-07-05 payload)', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'PreToolUse',
      tool_name: 'spawn_agent',
      tool_input: {
        agent_type: 'demo-orchestrator',
        message: 'Ejecuta la cadena demo completa.',
        fork_context: false,
      },
      tool_use_id: 'call_SpawnDemo000000000001',
    });
    assert.deepEqual(signals, [
      {
        phase: 'start',
        owner: 'main:0d3f7a10-51c2-4f5e-9b1a-2f6d8c4e7a90',
        spawn: {
          spawnId: 'call_SpawnDemo000000000001',
          phase: 'start',
          parentOwner: 'main:0d3f7a10-51c2-4f5e-9b1a-2f6d8c4e7a90',
          childKind: 'agent',
          childName: 'demo-orchestrator',
          prompt: 'Ejecuta la cadena demo completa.',
        },
      },
    ]);
  });

  it('an AGENT-context spawn rides a keep-alive heartbeat on the parent (no custody)', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'PreToolUse',
      agent_id: '019f324c-58fe-7400-8d49-8e47959e34ef',
      agent_type: 'demo-orchestrator',
      tool_name: 'spawn_agent',
      tool_input: { agent_type: 'demo-worker', message: 'Ejecuta tu proceso demo.' },
      tool_use_id: 'call_SpawnDemo000000000002',
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-orchestrator',
        phase: 'start',
        owner: '019f324c-58fe-7400-8d49-8e47959e34ef',
        keepAlive: true,
        spawn: {
          spawnId: 'call_SpawnDemo000000000002',
          phase: 'start',
          parentOwner: '019f324c-58fe-7400-8d49-8e47959e34ef',
          childKind: 'agent',
          childName: 'demo-worker',
          prompt: 'Ejecuta tu proceso demo.',
        },
      },
    ]);
  });

  it('the spawn PostToolUse handoff parses the child id from the JSON-string response', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'PostToolUse',
      tool_name: 'spawn_agent',
      tool_input: { agent_type: 'demo-orchestrator', message: 'run' },
      tool_response: '{"agent_id":"019f324c-58fe-7400-8d49-8e47959e34ef","nickname":"Hubble"}',
      tool_use_id: 'call_SpawnDemo000000000001',
    });
    assert.equal(signals![0]!.spawn?.phase, 'handoff');
    assert.equal(signals![0]!.spawn?.childOwner, '019f324c-58fe-7400-8d49-8e47959e34ef');
    // Unparseable response: handoff still emits, just without the id.
    const fallback = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'PostToolUse',
      tool_name: 'spawn_agent',
      tool_input: { agent_type: 'demo-orchestrator' },
      tool_response: 'not json at all',
      tool_use_id: 'call_SpawnDemo000000000003',
    });
    assert.equal(fallback![0]!.spawn?.childOwner, undefined);
  });

  it('a terminal SubagentStop carries the final message as the report', () => {
    const signals = codexActivity.mapEvent({
      ...COMMON,
      hook_event_name: 'SubagentStop',
      agent_id: '019f324e-2837-7823-b869-c24df08889b6',
      agent_type: 'demo-worker',
      agent_transcript_path: '/home/user/.codex/agents/agent-019f.jsonl',
      last_assistant_message: 'reporte final del worker',
      stop_hook_active: false,
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-worker',
        phase: 'end',
        owner: '019f324e-2837-7823-b869-c24df08889b6',
        ownerScope: true,
        report: 'reporte final del worker',
      },
    ]);
  });
});
