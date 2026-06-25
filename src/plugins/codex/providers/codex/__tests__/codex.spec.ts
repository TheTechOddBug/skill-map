/**
 * Unit tests for the built-in `codex` Provider. It classifies two on-disk
 * families under the codex lens: `.codex/agents/*.toml` sub-agents (its own
 * TOML rule) and `.agents/skills/<name>/SKILL.md` open-standard skills
 * (reusing the `agent-skills` classifier + kind + read + resolution +
 * reserved-name catalog by manifest composition). The mixed-format read is
 * expressed as a multi-rule `read` array, one parser per family.
 */

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { codexProvider } from '../index.js';
import { COMMONS_RESERVED_NAMES } from '../../../../agent-skills/providers/agent-skills/index.js';

describe('codex provider, manifest shape', () => {
  it('declares the vendor identity (gated lens, beta)', () => {
    strictEqual(codexProvider.id, 'codex');
    strictEqual(codexProvider.pluginId, 'codex');
    strictEqual(codexProvider.kind, 'provider');
    strictEqual(codexProvider.gatedByActiveLens, true);
    strictEqual(codexProvider.stability, 'beta');
    // Vendor marker stays `.codex/`; the open `.agents/` is owned by
    // `agent-skills` for auto-detect, not by codex.
    deepStrictEqual(codexProvider.detect?.markers, ['.codex']);
  });

  it('emits both the TOML agent kind and the open-standard skill kind', () => {
    ok(codexProvider.kinds['agent'], 'expected the codex agent kind');
    ok(codexProvider.kinds['skill'], 'expected the inherited skill kind');
  });

  it('reads two file families via a multi-rule `read` array', () => {
    const read = codexProvider.read;
    ok(Array.isArray(read), 'read should be a multi-rule array');
    const rules = read as Array<{ extensions: string[]; parser: string; bodyField?: string }>;
    strictEqual(rules.length, 2);

    // TOML sub-agents: prompt lives in the `developer_instructions` field.
    const toml = rules.find((r) => r.parser === 'toml');
    ok(toml, 'expected a TOML rule');
    ok(toml.extensions.includes('.toml'));
    strictEqual(toml.bodyField, 'developer_instructions');

    // Open-standard skills: plain markdown, no bodyField.
    const md = rules.find((r) => r.parser === 'frontmatter-yaml');
    ok(md, 'expected a markdown rule');
    ok(md.extensions.includes('.md'));
    strictEqual(md.bodyField, undefined);
  });

  it('resolves `@` mentions to agents and `/` invocations to skills', () => {
    deepStrictEqual(codexProvider.resolution?.['mentions'], ['agent']);
    deepStrictEqual(codexProvider.resolution?.['invokes'], ['skill']);
  });

  it('inherits the open-standard reserved-name base under `skill` (self scope)', () => {
    const reserved = codexProvider.reservedNames?.['skill'] ?? [];
    ok(reserved.length > 0, 'expected an inherited reserved-name catalog');
    for (const base of COMMONS_RESERVED_NAMES['skill'] ?? []) {
      ok(reserved.includes(base), `missing inherited base verb: ${base}`);
    }
  });
});

describe('codex provider, classify', () => {
  it('claims `.codex/agents/*.toml` as agent', () => {
    strictEqual(codexProvider.classify('.codex/agents/architect.toml', {}), 'agent');
    strictEqual(codexProvider.classify('.codex/agents/builder.toml', {}), 'agent');
  });

  it('claims `.agents/skills/<name>/SKILL.md` as skill (open standard)', () => {
    strictEqual(codexProvider.classify('.agents/skills/run-tests/SKILL.md', {}), 'skill');
    // Case-insensitive on the SKILL.md handle.
    strictEqual(codexProvider.classify('.agents/skills/changelog-entry/skill.md', {}), 'skill');
  });

  it('disclaims everything else (no proprietary `.codex/skills/`, no AGENTS.md)', () => {
    // Codex officially reads skills from the OPEN `.agents/skills/`, not a
    // proprietary `.codex/skills/`, so the latter is disclaimed.
    strictEqual(codexProvider.classify('.codex/skills/foo/SKILL.md', {}), null);
    strictEqual(codexProvider.classify('.codex/config.toml', {}), null);
    strictEqual(codexProvider.classify('AGENTS.md', {}), null);
    strictEqual(codexProvider.classify('docs/architecture.md', {}), null);
    // Supporting files inside a skill folder are not the entry point.
    strictEqual(codexProvider.classify('.agents/skills/run-tests/references/api.md', {}), null);
  });
});
