/**
 * OpenCode live-activity adapter (`activity.ts`): wrapped plugin
 * payload → activity signals. Shapes are REAL captures from the
 * 2026-07-04 live probe (the opencode activity fixture now consolidated
 * into `fixtures/opencode/`, opencode
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
    assert.equal('events' in opencodeActivity.install, false);
  });

  it('declares BLOCKING spawn custody (the parent cannot nap inside `task`)', () => {
    // Drives the resolver's `terminal: true` stamp on the owner release,
    // which is what clears a relation whose completion never arrives:
    // OpenCode caps delegation at one hop and refuses a nested `task`,
    // firing the before hook and never the after.
    assert.equal(opencodeActivity.spawnCustody, 'blocking');
  });

  it('pluginHooksSource registers exactly the consumed hooks, with the wiring filters', () => {
    const source = opencodeActivity.pluginHooksSource!;
    for (const hook of [
      "'tool.execute.before'",
      "'tool.execute.after'",
      "'command.execute.before'",
      "'chat.message'",
      "'chat.params'",
    ]) {
      assert.ok(source.includes(hook), hook);
    }
    // Wiring-level filters: only the spawn tool's completion and the
    // native end signal ever leave the host process.
    assert.ok(source.includes("input.tool === 'task'"));
    assert.ok(source.includes("event.type === 'session.idle'"));
    // Every registration forwards through the envelope's forward().
    assert.ok(source.includes("await forward('tool.execute.before'"));
  });

  it('maps the skill tool to a NAMED skill start (prose-invoked, real capture)', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'tool.execute.before',
      directory: DIR,
      input: { tool: 'skill', sessionID: SESSION, callID: 'call_00_9e' },
      output: { args: { name: 'demo-skill-two' } },
    });
    assert.deepEqual(signals, [
      { kind: 'skill', name: 'demo-skill-two', phase: 'start', owner: SESSION, detail: 'skill' },
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
        detail: 'read',
      },
    ]);
  });

  it('maps in-scope markdown write and edit to PATH signals with the tool as detail', () => {
    const write = opencodeActivity.mapEvent({
      hook: 'tool.execute.before',
      directory: DIR,
      input: { tool: 'write', sessionID: SESSION, callID: 'call_00_WR' },
      output: { args: { filePath: `${DIR}/notes/todo.md`, content: '# updated' } },
    });
    assert.deepEqual(write, [
      { path: 'notes/todo.md', phase: 'start', owner: SESSION, detail: 'write' },
    ]);
    const edit = opencodeActivity.mapEvent({
      hook: 'tool.execute.before',
      directory: DIR,
      input: { tool: 'edit', sessionID: SESSION, callID: 'call_00_ED' },
      output: {
        args: { filePath: `${DIR}/notes/todo.md`, oldString: 'before', newString: 'after' },
      },
    });
    assert.deepEqual(edit, [
      { path: 'notes/todo.md', phase: 'start', owner: SESSION, detail: 'edit' },
    ]);
  });

  it('write/edit filter: non-md and out-of-scope paths disclaim like read', () => {
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'tool.execute.before',
        directory: DIR,
        input: { tool: 'write', sessionID: SESSION },
        output: { args: { filePath: `${DIR}/src/index.ts`, content: 'x' } },
      }),
      null,
    );
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'tool.execute.before',
        directory: DIR,
        input: { tool: 'edit', sessionID: SESSION },
        output: { args: { filePath: '/elsewhere/readme.md', oldString: 'a', newString: 'b' } },
      }),
      null,
    );
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

  it('maps an MCP tool call to a PATH signal on mcp://<server> (real capture)', () => {
    // Live-verified 2026-07-11: OpenCode names MCP tools `<server>_<tool>`
    // (a Notion call arrives as `notion_notion-create-pages`); the server is
    // the prefix before the first `_`, the tool suffix rides as `detail`.
    const signals = opencodeActivity.mapEvent({
      hook: 'tool.execute.before',
      directory: DIR,
      input: { tool: 'notion_notion-create-pages', sessionID: SESSION, callID: 'toolu_01' },
      output: { args: { pages: [{ properties: { title: 'x' } }] } },
    });
    assert.deepEqual(signals, [
      { path: 'mcp://notion', phase: 'start', owner: SESSION, detail: 'notion-create-pages' },
    ]);
  });

  it('a non-underscore built-in tool disclaims (no `<server>_<tool>` shape)', () => {
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'tool.execute.before',
        directory: DIR,
        input: { tool: 'bash', sessionID: SESSION },
        output: { args: { command: 'ls' } },
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

  it('maps chat.params like chat.message (the pre-spawn agent-name source)', () => {
    // Same mapper on purpose: chat.params fires BEFORE each model call,
    // so the resolver's owner index learns "this session runs that
    // agent" before the turn's first `task` spawn; without it the first
    // delegation of a turn anchored on a session capsule because
    // chat.message only fires with the COMPLETED assistant message.
    const signals = opencodeActivity.mapEvent({
      hook: 'chat.params',
      directory: '/proj',
      input: { agent: 'orchestrator', sessionID: 'ses_early' },
    });
    assert.deepEqual(signals, [
      { kind: 'agent', name: 'orchestrator', phase: 'start', owner: 'ses_early', sticky: true },
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

  it('a task before maps to the relation-only spawn start (real 2026-07-05 payload)', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'tool.execute.before',
      directory: DIR,
      input: {
        tool: 'task',
        sessionID: SESSION,
        callID: 'call_00_SRzXlDZ3mj60RYlBdxoC7497',
      },
      output: {
        args: {
          description: 'Worker primera corrida',
          subagent_type: 'demo-worker',
          prompt: 'Ejecuta tu proceso demo completo.',
        },
      },
    });
    assert.deepEqual(signals, [
      {
        phase: 'start',
        owner: SESSION,
        spawn: {
          spawnId: 'call_00_SRzXlDZ3mj60RYlBdxoC7497',
          phase: 'start',
          parentOwner: SESSION,
          childKind: 'agent',
          childName: 'demo-worker',
          prompt: 'Ejecuta tu proceso demo completo.',
        },
      },
    ]);
  });

  it('a task after maps to the spawn end with child owner and unwrapped report', () => {
    const signals = opencodeActivity.mapEvent({
      hook: 'tool.execute.after',
      directory: DIR,
      input: {
        tool: 'task',
        sessionID: SESSION,
        callID: 'call_00_SRzXlDZ3mj60RYlBdxoC7497',
        args: { description: 'Worker primera corrida', subagent_type: 'demo-worker', prompt: 'x' },
      },
      output: {
        title: 'Worker primera corrida',
        metadata: { parentSessionId: SESSION, sessionId: 'ses_child01', truncated: false },
        output:
          '<task id="ses_child01" state="completed">\n<task_result>\nreporte final del worker\n</task_result>\n</task>',
      },
    });
    assert.deepEqual(signals, [
      {
        phase: 'start',
        owner: SESSION,
        spawn: {
          spawnId: 'call_00_SRzXlDZ3mj60RYlBdxoC7497',
          phase: 'end',
          parentOwner: SESSION,
          childKind: 'agent',
          childName: 'demo-worker',
          childOwner: 'ses_child01',
          response: 'reporte final del worker',
        },
      },
    ]);
    // Unrecognised output shape passes through verbatim; non-task afters disclaim.
    const fallback = opencodeActivity.mapEvent({
      hook: 'tool.execute.after',
      directory: DIR,
      input: { tool: 'task', sessionID: SESSION, callID: 'call_01' },
      output: { output: 'plain result text' },
    });
    assert.equal(fallback![0]!.spawn?.response, 'plain result text');
    assert.equal(
      opencodeActivity.mapEvent({
        hook: 'tool.execute.after',
        directory: DIR,
        input: { tool: 'read', sessionID: SESSION, callID: 'call_02' },
        output: {},
      }),
      null,
    );
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
