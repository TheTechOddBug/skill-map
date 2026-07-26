/**
 * Byte-level guarantees of the generated in-process activity plugin
 * (`plugin-template.ts`): the envelope invariants the spec names
 * (never-throw wrapping, serve.json discovery, loopback + scope + port
 * checks) plus the agent-doorbell integration (`spec/job-lifecycle.md`
 * §Agent doorbell): one registration at load, a refresh stamped on
 * every forwarded event, and both keyed off the runtime-provided
 * `serverUrl` (absent input -> both paths dormant, never an error).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { renderActivityPlugin, ACTIVITY_PLUGIN_MARKER } from '../plugin-template.js';

const HOOKS = `    'chat.message': async (input, output) => {
      await forward('chat.message', { input, output });
    },`;

describe('renderActivityPlugin (envelope bytes)', () => {
  const source = renderActivityPlugin('opencode', HOOKS);

  it('keeps the ownership marker and splices the provider hooks', () => {
    assert.ok(source.startsWith(`// ${ACTIVITY_PLUGIN_MARKER}`));
    assert.ok(source.includes("'chat.message': async (input, output)"));
    assert.ok(source.includes("const PROVIDER = 'opencode'"));
  });

  it('destructures serverUrl and registers the doorbell once at load', () => {
    assert.ok(source.includes('({ directory, serverUrl })'));
    // The one-time registration POST, fire-and-forget, silent.
    assert.ok(source.includes("'/api/agent/doorbell', { url: agentEndpoint }"));
    // Guarded on BOTH discovery and a usable serverUrl.
    assert.ok(source.includes('if (info !== null && agentEndpoint !== null)'));
  });

  it('stamps agentEndpoint onto every forwarded event (the refresh path)', () => {
    assert.ok(source.includes('if (agentEndpoint !== null) body.agentEndpoint = agentEndpoint;'));
    // The forward still carries the canonical { provider, event } shape.
    assert.ok(
      source.includes("{ provider: PROVIDER, event: { hook, directory: root, ...payload } }"),
    );
  });

  it('keeps the discovery invariants: scope pin, loopback pin, port sanity', () => {
    assert.ok(source.includes('info.scopeRoot !== root'));
    assert.ok(source.includes('LOOPBACK_HOSTS.has(info.host.toLowerCase())'));
    assert.ok(source.includes('Number.isInteger(info.port)'));
  });

  it('is loadable ESM that tolerates a serverUrl-less input (older runtimes)', async () => {
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const mod = (await import(moduleUrl)) as {
      SkillMapActivity: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    // No serverUrl, no directory: both integration paths stay dormant
    // and the plugin still returns its hooks map without throwing.
    const hooks = await mod.SkillMapActivity({});
    assert.equal(typeof hooks['chat.message'], 'function');
    // Calling a hook with no server around resolves silently (never throws).
    await (hooks['chat.message'] as (a: unknown, b: unknown) => Promise<void>)({}, {});
  });
});
