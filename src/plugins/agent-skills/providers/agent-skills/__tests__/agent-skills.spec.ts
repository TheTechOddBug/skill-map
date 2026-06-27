import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProviderWalk } from '../../../../../kernel/extensions/index.js';
import { agentSkillsProvider, COMMONS_RESERVED_NAMES } from '../index.js';

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

  it('declares NO reserved skill names (the neutral open standard has no `/`-invocation)', () => {
    // The Agent Skills standard activates a skill by its `description`, not a
    // `/` command, so a skill name cannot shadow a built-in `/` command; the
    // neutral lens reserves nothing.
    strictEqual(agentSkillsProvider.reservedNames, undefined);
    // The shared COMMONS_RESERVED_NAMES catalog still exists, but only for
    // `/`-invoking vendors (e.g. antigravity) to spread into their OWN manifest.
    ok(COMMONS_RESERVED_NAMES['skill']?.includes('help'), 'shared base still carries the universal `help`');
    ok(!COMMONS_RESERVED_NAMES['skill']?.includes('goal'), '`goal` is Antigravity-specific, not the shared base');
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

  it('skill schema accepts the open-standard optional fields', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([agentSkillsProvider]);
    const result = validator.validate(agentSkillsProvider, 'skill', {
      name: 'x',
      description: 'y',
      license: 'Apache-2.0',
      compatibility: 'Requires git, docker, and node 20+',
      metadata: { author: 'example-org', version: '1.0' },
      'allowed-tools': 'Bash(git:*) Read',
    });
    ok(result.ok, `optional standard fields must validate: ${result.ok ? '' : result.errors}`);
  });

  it('skill schema accepts compatibility at the 500-char boundary', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([agentSkillsProvider]);
    const result = validator.validate(agentSkillsProvider, 'skill', {
      name: 'x',
      description: 'y',
      compatibility: 'a'.repeat(500),
    });
    ok(result.ok, 'compatibility of exactly 500 chars must validate');
  });

  it('skill schema rejects compatibility over 500 chars (maxLength constraint)', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([agentSkillsProvider]);
    const result = validator.validate(agentSkillsProvider, 'skill', {
      name: 'x',
      description: 'y',
      compatibility: 'a'.repeat(501),
    });
    strictEqual(result.ok, false, 'compatibility over 500 chars must be rejected');
  });

  it('skill schema enforces the open-standard `name` rules (lowercase/hyphen pattern + maxLength 64)', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([agentSkillsProvider]);
    ok(
      validator.validate(agentSkillsProvider, 'skill', { name: 'pdf-processing', description: 'y' }).ok,
      'a valid lowercase-hyphen name must validate',
    );
    // uppercase, leading/trailing hyphen, consecutive hyphens, over 64 chars.
    for (const bad of ['PDF-Processing', '-foo', 'foo-', 'a--b', 'a'.repeat(65)]) {
      strictEqual(
        validator.validate(agentSkillsProvider, 'skill', { name: bad, description: 'y' }).ok,
        false,
        `name '${bad}' must be rejected by the open-standard pattern/length`,
      );
    }
  });

  it('skill schema enforces the open-standard `description` maxLength (1024)', async () => {
    const { buildProviderFrontmatterValidator } = await import(
      '../../../../../kernel/adapters/schema-validators.js'
    );
    const validator = buildProviderFrontmatterValidator([agentSkillsProvider]);
    ok(
      validator.validate(agentSkillsProvider, 'skill', { name: 'x', description: 'a'.repeat(1024) }).ok,
      'description of exactly 1024 chars must validate',
    );
    strictEqual(
      validator.validate(agentSkillsProvider, 'skill', { name: 'x', description: 'a'.repeat(1025) }).ok,
      false,
      'description over 1024 chars must be rejected',
    );
  });

  it('declares normalised UI presentation (mirrors Claude for the `skill` kind)', () => {
    const skillUi = agentSkillsProvider.kinds['skill']!.ui;
    strictEqual(skillUi.label, 'Skills');
    ok(/^#[0-9a-fA-F]{6}$/.test(skillUi.color));
  });
});
