/**
 * Unit tests for the built-in `antigravity` Provider. The Provider is
 * metadata-only today: no `classify()` territory, no `kinds`, only a
 * reserved-name catalog captured verbatim from `agy /help` (Antigravity
 * CLI v1.0.3).
 *
 * The catalog is dormant in the live pipeline (the analyzer keys on
 * `node.provider` and no path classifies under `antigravity`), so these
 * tests verify the manifest shape directly rather than running the
 * analyzer end-to-end. The day Antigravity grows its own kind, the
 * existing `core/name-reserved` integration tests pick up coverage
 * automatically.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { antigravityProvider } from '../index.js';

describe('antigravity provider, manifest shape', () => {
  it('declares the metadata-only shape (no `read`, empty kinds, classify returns null)', () => {
    strictEqual(antigravityProvider.id, 'antigravity');
    strictEqual(antigravityProvider.pluginId, 'antigravity');
    strictEqual(antigravityProvider.kind, 'provider');
    strictEqual(antigravityProvider.gatedByActiveLens, true);
    deepStrictEqual(antigravityProvider.kinds, {});
    strictEqual(antigravityProvider.classify?.('.agents/skills/foo/SKILL.md', {}), null);
    strictEqual(antigravityProvider.classify?.('AGENTS.md', {}), null);
    strictEqual(antigravityProvider.classify?.('random.md', {}), null);
  });
});

describe('antigravity provider, reserved-name catalog (official, captured from `agy /help` v1.0.3)', () => {
  // Declared under the `skill` kind, not `command`: Antigravity user
  // slash-commands are skills (`.agents/skills/`), and the catalog fires
  // via the orchestrator's lens scope against those `agent-skills` nodes.
  const commands = antigravityProvider.reservedNames?.['skill'] ?? [];

  it('declares its catalog under the `skill` kind (lens-scope target), not `command`', () => {
    ok(antigravityProvider.reservedNames?.['skill'], 'expected reservedNames.skill');
    strictEqual(antigravityProvider.reservedNames?.['command'], undefined);
  });

  it('carries the 35 primary slash verbs plus the 8 documented aliases', () => {
    // 35 primaries from `agy /help` (v1.0.3) + 8 aliases inline in that
    // output: /clear (new), /config (settings), /exit (quit),
    // /fork (branch), /resume (switch, conversation), /rewind (undo),
    // /usage (quota). Total = 35 + 8 = 43 entries.
    strictEqual(commands.length, 43);
  });

  it('includes every agy primary slash verb', () => {
    const primaries = [
      'add-dir', 'agents', 'artifact', 'btw', 'changelog', 'clear',
      'config', 'context', 'copy', 'credits', 'diff', 'exit', 'fast',
      'feedback', 'fork', 'goal', 'grill-me', 'help', 'hooks',
      'keybindings', 'logout', 'mcp', 'model', 'open', 'permissions',
      'planning', 'rename', 'resume', 'rewind', 'schedule', 'skills',
      'statusline', 'tasks', 'title', 'usage',
    ];
    strictEqual(primaries.length, 35);
    for (const verb of primaries) {
      ok(commands.includes(verb), `missing primary verb: ${verb}`);
    }
  });

  it('includes the 8 documented aliases', () => {
    const aliases = ['new', 'settings', 'quit', 'branch', 'switch', 'conversation', 'undo', 'quota'];
    strictEqual(aliases.length, 8);
    for (const alias of aliases) {
      ok(commands.includes(alias), `missing alias: ${alias}`);
    }
  });

  it('drops the Gemini-only verbs that agy retired', () => {
    // These shipped in the earlier provisional Gemini-derived list but are
    // absent from `agy /help`; keeping them would flag false collisions.
    for (const gone of ['vim', 'theme', 'terminal-setup', 'setup-github', 'bashes', 'shells', 'policies', 'extensions', '?', 'dir']) {
      ok(!commands.includes(gone), `should not carry retired Gemini verb: ${gone}`);
    }
  });

  it('contains no duplicate entries', () => {
    strictEqual(new Set(commands).size, commands.length);
  });

  it('flags the high-collision verbs (`skills`, `hooks`, `agents`, `mcp`) that back Antigravity extensibility', () => {
    // Agent Skills, Hooks, Subagents, and MCP servers are first-class
    // extensibility surfaces with a matching built-in slash command; a user
    // file named after any of them collides once the catalog activates.
    for (const verb of ['skills', 'hooks', 'agents', 'mcp']) {
      ok(commands.includes(verb), `missing high-collision verb: ${verb}`);
    }
  });
});
