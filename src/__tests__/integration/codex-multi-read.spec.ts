/**
 * Integration: the codex provider's multi-rule `read` walks BOTH file
 * families in a single `resolveProviderWalk` pass, its `.toml` sub-agents
 * (whose prompt is surfaced from the `developer_instructions` field via
 * `read.bodyField`) and its `.md` open-standard skills. Exercises the
 * kernel's array-`read` support against the real provider manifest.
 */

import { describe, it, before, after } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProviderWalk, type IRawNode } from '../../kernel/extensions/index.js';
import { codexProvider } from '../../plugins/codex/providers/codex/index.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-multi-read-'));
  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // TOML sub-agent: the markdown prompt lives in `developer_instructions`.
  write(
    '.codex/agents/architect.toml',
    [
      'name = "architect"',
      'description = "owns the design"',
      'developer_instructions = "Hand to @builder, see docs/architecture.md"',
    ].join('\n'),
  );
  // Open-standard skill: plain markdown with a frontmatter fence.
  write(
    '.agents/skills/run-tests/SKILL.md',
    ['---', 'name: run-tests', 'description: run the suite', '---', 'Follow the testing guide.'].join('\n'),
  );
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('codex provider, multi-rule read walk', () => {
  it('yields both the TOML agent and the markdown skill in one walk', async () => {
    const yielded: IRawNode[] = [];
    for await (const raw of resolveProviderWalk(codexProvider)([root])) {
      yielded.push(raw);
    }
    const byPath = new Map(yielded.map((n) => [n.path, n]));

    // TOML rule: body comes from `developer_instructions` (bodyField), not
    // an absent post-fence body.
    const agent = byPath.get('.codex/agents/architect.toml');
    ok(agent, 'expected the TOML sub-agent to be walked');
    ok(agent.body.includes('@builder'), 'agent body should be developer_instructions');
    strictEqual(agent.frontmatter['name'], 'architect');

    // Markdown rule: body is the prose after the frontmatter fence.
    const skill = byPath.get('.agents/skills/run-tests/SKILL.md');
    ok(skill, 'expected the open-standard skill to be walked');
    ok(skill.body.includes('testing guide'), 'skill body should be the markdown body');
    strictEqual(skill.frontmatter['name'], 'run-tests');
  });
});
