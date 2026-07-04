/**
 * OpenCode live-activity adapter (`activity.ts`): wrapped plugin
 * payload → activity signals. Shapes are REAL captures from the
 * 2026-07-04 live probe (`fixtures/realtime-opencode/`, opencode
 * v1.17.11): `tool.execute.before` splits `{tool, sessionID, callID}`
 * (input) from `{args}` (output); `command.execute.before` carries
 * `{command, sessionID, arguments}`; `chat.message` carries the NAMED
 * agent + sessionID; `session.idle` arrives via the `event` catch-all.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { opencodeActivity } from '../activity.js';

const DIR = '/home/user/project';
const SESSION = 'ses_0d1e16beaffeWpwkol2pQXpyLm';

describe('opencodeActivity.mapEvent', () => {
  it('declares the plugin-file descriptor (no events list, no group)', () => {
    assert.equal(opencodeActivity.install.kind, 'plugin-file');
    assert.equal(opencodeActivity.install.configPath, '.opencode/plugin/skill-map-activity.js');
    assert.equal(opencodeActivity.install.events, undefined);
  });

  it('maps the skill tool to a NAMED skill start (prose-invoked, real capture)', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'tool.execute.before',
      directory: DIR,
      input: { tool: 'skill', sessionID: SESSION, callID: 'call_00_9e' },
      output: { args: { name: 'demo-skill-two' } },
    });
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'demo-skill-two', phase: 'start', owner: SESSION },
    ]);
  });

  it('maps an in-scope markdown read to a PATH signal', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'tool.execute.before',
      directory: DIR,
      input: { tool: 'read', sessionID: SESSION, callID: 'call_00_QO' },
      output: {
        args: { filePath: `${DIR}/.agents/skills/demo-skill-two/references/valor.md` },
      },
    });
    assert.deepEqual(signals, [
      {
        path: '.agents/skills/demo-skill-two/references/valor.md',
        phase: 'start',
        owner: SESSION,
      },
    ]);
  });

  it('filter-first: non-md reads, out-of-scope reads, other tools disclaim', () => {
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'tool.execute.before',
        directory: DIR,
        input: { tool: 'read', sessionID: SESSION },
        output: { args: { filePath: `${DIR}/src/index.ts` } },
      }),
      null,
    );
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'tool.execute.before',
        directory: DIR,
        input: { tool: 'read', sessionID: SESSION },
        output: { args: { filePath: '/elsewhere/readme.md' } },
      }),
      null,
    );
    // The task spawn itself maps to nothing (the child lights via its
    // own chat.message under its own sessionID).
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'tool.execute.before',
        directory: DIR,
        input: { tool: 'task', sessionID: SESSION },
        output: { args: { description: 'Ejecutar cadena demo', subagent_type: 'demo-worker' } },
      }),
      null,
    );
  });

  it('maps command.execute.before to a NAMED command start (real capture)', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'command.execute.before',
      directory: DIR,
      input: { command: 'demo-cmd', sessionID: SESSION, arguments: '' },
      output: { parts: [] },
    });
    assert.deepEqual(signals, [
      { kind: 'command', name: 'demo-cmd', phase: 'start', owner: SESSION },
    ]);
  });

  it('maps chat.message to a sticky NAMED agent start under its own session', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'chat.message',
      directory: DIR,
      input: {
        sessionID: 'ses_0d1e003a5ffeX6wIxEPVFFhTfd',
        agent: 'demo-worker',
        model: 'deepseek-v4',
        messageID: 'msg_x',
        variant: 'chat',
      },
    });
    assert.deepEqual(signals, [
      {
        kind: 'agent',
        name: 'demo-worker',
        phase: 'start',
        owner: 'ses_0d1e003a5ffeX6wIxEPVFFhTfd',
        sticky: true,
      },
    ]);
  });

  it('maps session.idle to the node-less OWNER RELEASE (real capture)', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'event',
      directory: DIR,
      event: { type: 'session.idle', properties: { sessionID: SESSION } },
    });
    assert.deepEqual(signals, [{ phase: 'end', owner: SESSION, ownerScope: true }]);
  });

  it('re-checks the bus event type (a smuggled event maps to nothing)', () => {
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'event',
        directory: DIR,
        event: { type: 'session.created', properties: { sessionID: SESSION } },
      }),
      null,
    );
    assert.equal(opencodeActivity.mapEvent({ hook: 'nope' }), null);
    assert.equal(opencodeActivity.mapEvent(null), null);
  });
});
