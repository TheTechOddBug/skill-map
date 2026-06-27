/**
 * Unit tests for the built-in `antigravity` Provider. It has two on-disk
 * families: the open-standard `skill` (reusing the `agent-skills` classifier
 * + kind at `.agents/skills/<name>/SKILL.md`) and its OWN `workflow` kind at
 * `.agent/workflows/<name>.md`. It carries a reserved-name catalog captured
 * verbatim from `agy /help` (Antigravity CLI v1.0.3) under the `skill` kind;
 * under the antigravity lens a skill classifies as `antigravity`/`skill`, so
 * the catalog fires via SELF scope (see `reserved-name-lens-scope.spec.ts`
 * for the end-to-end case).
 */

import { describe, it } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';

import { antigravityProvider } from '../index.js';
import { COMMONS_RESERVED_NAMES } from '../../../../agent-skills/providers/agent-skills/index.js';

describe('antigravity provider, manifest shape', () => {
  it('adopts the open-standard `.agents/skills/` layout (inherited classifier + kind)', () => {
    strictEqual(antigravityProvider.id, 'antigravity');
    strictEqual(antigravityProvider.pluginId, 'antigravity');
    strictEqual(antigravityProvider.kind, 'provider');
    strictEqual(antigravityProvider.gatedByActiveLens, true);
    strictEqual(antigravityProvider.stability, 'beta');
    // Inherited from agent-skills: the open-standard skill kind, read
    // config, and classifier.
    ok(antigravityProvider.kinds['skill'], 'expected the inherited skill kind');
    ok(antigravityProvider.read, 'expected the inherited read config');
    strictEqual(antigravityProvider.classify?.('.agents/skills/foo/SKILL.md', {}), 'skill');
    strictEqual(antigravityProvider.classify?.('AGENTS.md', {}), null);
    strictEqual(antigravityProvider.classify?.('random.md', {}), null);
  });

  it('declares `.agent/workflows/` as its one vendor detect marker', () => {
    // Singular `.agent`, not the shared open-standard `.agents/` (owned by
    // agent-skills). Live now that antigravity ships beta (enabled by
    // default), so a `.agent/workflows/` project auto-detects this lens.
    deepStrictEqual(antigravityProvider.detect, { markers: ['.agent/workflows'] });
  });
});

describe('antigravity provider, own `workflow` kind', () => {
  it('declares the `workflow` kind alongside the inherited `skill`', () => {
    ok(antigravityProvider.kinds['workflow'], 'expected the own workflow kind');
    ok(antigravityProvider.kinds['skill'], 'expected the inherited skill kind');
    strictEqual(antigravityProvider.kinds['workflow']?.ui.label, 'Workflows');
    // The handle is ALWAYS the filename stem: Antigravity workflows have no
    // `name` frontmatter field, so there is no override source.
    deepStrictEqual(antigravityProvider.kinds['workflow']?.identifiers, [
      'filename-basename',
    ]);
  });

  it('classifies `.agent/workflows/<name>.md` (singular) as `workflow`', () => {
    strictEqual(antigravityProvider.classify?.('.agent/workflows/deploy.md', {}), 'workflow');
    strictEqual(antigravityProvider.classify?.('.agent/workflows/run_app.md', {}), 'workflow');
    // Case-insensitive, mirroring the skill classifier.
    strictEqual(antigravityProvider.classify?.('.agent/workflows/Deploy.MD', {}), 'workflow');
  });

  it('does NOT claim the plural `.agents/workflows/` nor nested workflow paths', () => {
    // Plural `.agents/` is the open standard (skills home); a `workflows`
    // subdir there is not Antigravity's territory.
    strictEqual(antigravityProvider.classify?.('.agents/workflows/deploy.md', {}), null);
    // One file level only: no subfolder between `workflows/` and the file.
    strictEqual(antigravityProvider.classify?.('.agent/workflows/sub/deploy.md', {}), null);
  });

  it('resolves `/<name>` slash invocations to BOTH skills and workflows', () => {
    deepStrictEqual(antigravityProvider.resolution, { invokes: ['skill', 'workflow'] });
  });
});

describe('antigravity provider, reserved-name catalog (official, captured from `agy /help` v1.0.3)', () => {
  // Declared under the `skill` kind, not `command`: Antigravity user
  // slash-commands are skills (`.agents/skills/`), classified as
  // `antigravity`/`skill` under its lens (inherited classifier), so the
  // catalog fires via self scope.
  const commands = antigravityProvider.reservedNames?.['skill'] ?? [];

  it('declares its catalog under both slash-invocable kinds (`skill` + `workflow`), not `command`', () => {
    ok(antigravityProvider.reservedNames?.['skill'], 'expected reservedNames.skill');
    ok(antigravityProvider.reservedNames?.['workflow'], 'expected reservedNames.workflow');
    // Both kinds are `/<name>`-invocable, so the catalog is identical.
    deepStrictEqual(
      antigravityProvider.reservedNames?.['workflow'],
      antigravityProvider.reservedNames?.['skill'],
    );
    // Antigravity has no on-disk command directory.
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

  it('inherits the open-standard base catalog (composition from agent-skills)', () => {
    // The universal cross-agent verbs are owned by `agent-skills` and
    // spread in here; antigravity only appends its own runtime-specific
    // verbs on top. No base verb may be missing (and no dupes, per above).
    for (const base of COMMONS_RESERVED_NAMES['skill'] ?? []) {
      ok(commands.includes(base), `missing inherited base verb: ${base}`);
    }
    // `goal` is Antigravity-specific, so it must NOT live in the neutral base.
    ok(!(COMMONS_RESERVED_NAMES['skill'] ?? []).includes('goal'));
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
