/**
 * Unit tests for the built-in `opencode` Provider. OpenCode is an
 * open-source, model-agnostic terminal coding agent; under the opencode lens
 * this provider classifies its OWN agents (`.opencode/agent/*.md`) and
 * commands (`.opencode/commands/*.md`), plus skills from the three project
 * homes OpenCode reads (`.opencode/skills/`, `.claude/skills/`,
 * `.agents/skills/`). Claude-compat is asymmetric: skills cross over, agents
 * and commands do NOT.
 *
 * The final block cross-checks the claude provider directly: it disclaims
 * every opencode-owned path, and opencode disclaims claude agents/commands, so
 * adding the opencode lens cannot change what the claude lens classifies (the
 * "don't break Claude" guarantee, which also holds structurally because both
 * lenses are `gatedByActiveLens`).
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { opencodeProvider } from '../index.js';
import { claudeProvider } from '../../../../claude/providers/claude/index.js';

describe('opencode provider, manifest shape', () => {
  it('declares the vendor identity (gated lens, beta, slash sigil)', () => {
    strictEqual(opencodeProvider.id, 'opencode');
    strictEqual(opencodeProvider.pluginId, 'opencode');
    strictEqual(opencodeProvider.kind, 'provider');
    strictEqual(opencodeProvider.gatedByActiveLens, true);
    strictEqual(opencodeProvider.stability, 'beta');
    deepStrictEqual(opencodeProvider.detect?.markers, ['.opencode']);
    // No strong model vendor: bare product label, not a `<Vendor>'s` possessive.
    strictEqual(opencodeProvider.presentation.label, 'OpenCode');
    strictEqual(opencodeProvider.presentation.invocationSigil, '/');
  });

  it('declares config-side MCP discovery over the project-local opencode.json', () => {
    // OpenCode's MCP config is project-local (committable), so the provider
    // reads it config-side (unlike Antigravity, whose config is home-global).
    deepStrictEqual(opencodeProvider.mcpConfig?.sources, [
      { path: 'opencode.json', dialect: 'json-mcp-servers' },
    ]);
  });

  it('emits its own agent + command kinds and the inherited skill kind', () => {
    ok(opencodeProvider.kinds['agent'], 'expected the opencode agent kind');
    ok(opencodeProvider.kinds['command'], 'expected the opencode command kind');
    ok(opencodeProvider.kinds['skill'], 'expected the inherited open-standard skill kind');
  });

  it('reads one markdown family (single read rule, every family is .md)', () => {
    const read = opencodeProvider.read;
    ok(read && !Array.isArray(read), 'read should be a single rule, not a multi-rule array');
    const rule = read as { extensions: string[]; parser: string };
    deepStrictEqual(rule.extensions, ['.md']);
    strictEqual(rule.parser, 'frontmatter-yaml');
  });

  it('resolves `/` invocations to commands only (skills are tool-loaded)', () => {
    deepStrictEqual(opencodeProvider.resolution?.['invokes'], ['command']);
    // OpenCode's skills load via the native `skill` tool, not a body sigil, so
    // there is no `mentions` channel and `/` never targets a skill.
    strictEqual(opencodeProvider.resolution?.['mentions'], undefined);
  });

  it('reserves OpenCode built-in slash commands under the command kind', () => {
    const reserved = opencodeProvider.reservedNames?.['command'] ?? [];
    ok(reserved.includes('init'), 'expected OpenCode built-in /init reserved');
    ok(reserved.includes('share'), 'expected OpenCode built-in /share reserved');
    ok(reserved.includes('help'), 'expected the universal base verb /help reserved');
    // Skills are not slash-invoked, so no reserved skill names.
    strictEqual(opencodeProvider.reservedNames?.['skill'], undefined);
  });
});

describe('opencode provider, classify (own territory + the skill homes it reads)', () => {
  it('claims `.opencode/agent/<name>.md` as agent (singular `agent`)', () => {
    strictEqual(
      opencodeProvider.classify('.opencode/agent/opencode-agent-review.md', {}),
      'agent',
    );
  });

  it('claims `.opencode/commands/<name>.md` as command (plural `commands`)', () => {
    strictEqual(
      opencodeProvider.classify('.opencode/commands/opencode-cmd-deploy.md', {}),
      'command',
    );
  });

  it('claims skills from all three project homes OpenCode searches', () => {
    strictEqual(
      opencodeProvider.classify('.opencode/skills/opencode-skill-lint/SKILL.md', {}),
      'skill',
    );
    strictEqual(
      opencodeProvider.classify('.claude/skills/claude-skill-format/SKILL.md', {}),
      'skill',
    );
    strictEqual(
      opencodeProvider.classify('.agents/skills/standard-skill-test/SKILL.md', {}),
      'skill',
    );
    // Case-insensitive on the SKILL.md handle.
    strictEqual(
      opencodeProvider.classify('.opencode/skills/opencode-skill-lint/skill.md', {}),
      'skill',
    );
  });
});

describe('opencode provider, classify (Claude-compat is asymmetric)', () => {
  it('does NOT claim Claude agents or commands (compat is skills-only)', () => {
    // The crux of the asymmetry: OpenCode reads Claude SKILLS, not Claude
    // agents/commands (those use Claude's own frontmatter). Disclaimed here so
    // they fall through to core/markdown under the opencode lens.
    strictEqual(opencodeProvider.classify('.claude/agents/claude-agent-helper.md', {}), null);
    strictEqual(opencodeProvider.classify('.claude/commands/claude-cmd-status.md', {}), null);
  });

  it('disclaims support files, flat skills, and unrelated markdown', () => {
    strictEqual(
      opencodeProvider.classify('.opencode/skills/opencode-skill-lint/reference.md', {}),
      null,
    );
    strictEqual(opencodeProvider.classify('.opencode/skills/flat-no-folder.md', {}), null);
    strictEqual(opencodeProvider.classify('AGENTS.md', {}), null);
    strictEqual(opencodeProvider.classify('docs/architecture.md', {}), null);
  });
});

describe('opencode provider does not break Claude (both lenses gated)', () => {
  it('the claude provider disclaims every opencode-owned path', () => {
    // Structural guarantee: claude.classify never claims opencode territory,
    // so adding the opencode lens cannot change what the claude lens sees.
    strictEqual(claudeProvider.classify('.opencode/agent/opencode-agent-review.md', {}), null);
    strictEqual(claudeProvider.classify('.opencode/commands/opencode-cmd-deploy.md', {}), null);
    strictEqual(claudeProvider.classify('.opencode/skills/opencode-skill-lint/SKILL.md', {}), null);
  });

  it('claude still owns its own agents and commands', () => {
    // Symmetric check: since opencode disclaims them, under the claude lens
    // these remain claude/agent + claude/command, unchanged by this feature.
    strictEqual(claudeProvider.classify('.claude/agents/claude-agent-helper.md', {}), 'agent');
    strictEqual(claudeProvider.classify('.claude/commands/claude-cmd-status.md', {}), 'command');
  });
});
