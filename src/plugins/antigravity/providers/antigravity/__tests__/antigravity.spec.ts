/**
 * Unit tests for the built-in `antigravity` Provider. The Provider is
 * metadata-only today: no `classify()` territory, no `kinds`, only a
 * reserved-name seed catalog mirroring the Gemini CLI slash-command
 * surface (Antigravity CLI replaced Gemini CLI on 2026-05-19 and shares
 * the same agent harness).
 *
 * The catalog is dormant in the live pipeline (the analyzer keys on
 * `node.provider` and no path classifies under `antigravity`), so these
 * tests verify the manifest shape directly rather than running the
 * analyzer end-to-end. The day Antigravity grows its own kind, the
 * existing `core/reserved-name` integration tests pick up coverage
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

describe('antigravity provider, reserved-name catalog (provisional, derived from Gemini CLI)', () => {
  const commands = antigravityProvider.reservedNames?.['command'] ?? [];

  it('carries the full 38-verb Gemini CLI slash-command catalog plus its 4 documented aliases', () => {
    // Primaries documented at https://google-gemini.github.io/gemini-cli/docs/cli/commands.html
    // and https://geminicli.com/docs/reference/commands/. Aliases inline:
    //   /directory -> /dir, /help -> /?, /quit -> /exit, /shells -> /bashes.
    // Total = 38 primaries + 4 aliases = 42 entries.
    strictEqual(commands.length, 42);
  });

  it('includes every Gemini CLI primary slash verb', () => {
    const primaries = [
      'about', 'agents', 'auth', 'bug', 'chat', 'clear', 'commands',
      'compress', 'copy', 'directory', 'docs', 'editor', 'extensions',
      'help', 'hooks', 'ide', 'init', 'mcp', 'memory', 'model',
      'permissions', 'plan', 'policies', 'privacy', 'quit', 'restore',
      'resume', 'rewind', 'settings', 'setup-github', 'shells', 'skills',
      'stats', 'terminal-setup', 'theme', 'tools', 'upgrade', 'vim',
    ];
    for (const verb of primaries) {
      ok(commands.includes(verb), `missing primary verb: ${verb}`);
    }
  });

  it('includes the 4 documented aliases (`dir`, `?`, `exit`, `bashes`)', () => {
    for (const alias of ['dir', '?', 'exit', 'bashes']) {
      ok(commands.includes(alias), `missing alias: ${alias}`);
    }
  });

  it('contains no duplicate entries', () => {
    strictEqual(new Set(commands).size, commands.length);
  });

  it('flags the high-collision verbs (`skills`, `hooks`, `agents`, `extensions`) that map directly onto the four Gemini CLI feature pillars preserved by Antigravity', () => {
    // The transition blog explicitly names these four pillars as carried
    // over from Gemini CLI into Antigravity CLI; user files that name a
    // skill or command after any of them will collide once the catalog
    // activates.
    for (const verb of ['skills', 'hooks', 'agents', 'extensions']) {
      ok(commands.includes(verb), `missing high-collision pillar verb: ${verb}`);
    }
  });
});
