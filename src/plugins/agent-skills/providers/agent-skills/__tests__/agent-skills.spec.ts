import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProviderWalk } from '../../../../../kernel/extensions/index.js';
import { agentSkillsProvider } from '../index.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-skills-provider-'));
  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  write(
    '.agents/skills/code-review/SKILL.md',
    ['---', 'name: code-review', 'description: An open-standard skill', '---', 'Skill body.'].join('\n'),
  );
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('agent-skills provider', () => {
  it('walks the scope and yields the SKILL.md file', async () => {
    const collected: string[] = [];
    for await (const n of resolveProviderWalk(agentSkillsProvider)([root])) {
      collected.push(n.path);
    }
    deepStrictEqual(collected, ['.agents/skills/code-review/SKILL.md']);
  });

  it('classifies the open-standard path as `skill`', () => {
    strictEqual(agentSkillsProvider.classify('.agents/skills/x/SKILL.md', {}), 'skill');
    // Case-insensitive on the filename.
    strictEqual(agentSkillsProvider.classify('.agents/skills/x/skill.md', {}), 'skill');
    // Supporting files inside a skill folder are disclaimed; only the
    // canonical `<name>/SKILL.md` entry-point is reclaimed here.
    strictEqual(agentSkillsProvider.classify('.agents/skills/x/README.md', {}), null);
    strictEqual(agentSkillsProvider.classify('.agents/skills/x/helpers.md', {}), null);
    strictEqual(agentSkillsProvider.classify('.agents/skills/x/sub/SKILL.md', {}), null);
    // Foreign vendor territory is disclaimed.
    strictEqual(agentSkillsProvider.classify('.claude/skills/x/SKILL.md', {}), null);
    strictEqual(agentSkillsProvider.classify('.gemini/skills/x/SKILL.md', {}), null);
    strictEqual(agentSkillsProvider.classify('README.md', {}), null);
  });

  it('declares declarative `read`', () => {
    deepStrictEqual(agentSkillsProvider.read, { extensions: ['.md'], parser: 'frontmatter-yaml' });
    strictEqual(agentSkillsProvider.walk, undefined);
  });

  it('skill schema validates name + description (the open-standard required fields)', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([agentSkillsProvider]);
    const result = validator.validate(agentSkillsProvider, 'skill', {
      name: 'x',
      description: 'y',
    });
    ok(result.ok, `skill frontmatter must validate`);
  });

  it('declares normalised UI presentation (mirrors Claude for the `skill` kind)', () => {
    const skillUi = agentSkillsProvider.kinds['skill']!.ui;
    strictEqual(skillUi.label, 'Skills');
    ok(/^#[0-9a-fA-F]{6}$/.test(skillUi.color));
  });
});
