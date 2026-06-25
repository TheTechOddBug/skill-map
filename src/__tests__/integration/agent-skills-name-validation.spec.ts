/**
 * End-to-end coverage that the agent-skills `skill` frontmatter schema,
 * tightened to the open-standard `name` pattern/length and `description`
 * length, actually fires through a real scan under the agent-skills lens,
 * not only at the validator unit level (`agent-skills.spec.ts`).
 *
 * The per-kind frontmatter schema is enforced by the ORCHESTRATOR (via the
 * `buildProviderFrontmatterValidator` composed from every loaded Provider's
 * `kinds[<kind>].schemaJson`), which emits a kernel `frontmatter-invalid`
 * issue on failure, NOT the `core/schema-violation` analyzer (that one only
 * checks the node's structural record + the missing-base-field fallback).
 * Default scans surface it as `warn`; `--strict` promotes it to `error`.
 *
 * This locks the tightening in place: if someone loosens the agent-skills
 * `skill` schema, the regression shows up here.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';

let fixture: string;

const skill = (name: string, description: string): string =>
  ['---', `name: ${name}`, `description: ${description}`, '---', 'Body.'].join('\n');

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-agent-skills-schema-e2e-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // Conforms to the open standard: lowercase, hyphenated, <= 64 chars.
  write('.agents/skills/good-skill/SKILL.md', skill('good-skill', 'A conforming open-standard skill.'));
  // `name` breaks the open-standard pattern (uppercase). The folder is
  // lowercase so the classifier still claims the file as agent-skills/skill.
  write(
    '.agents/skills/bad-name/SKILL.md',
    skill('BadName', 'A skill whose name breaks the open-standard pattern.'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

const scan = (activeProvider: string) => {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  return runScan(kernel, { roots: [fixture], extensions: builtIns(), activeProvider });
};

const frontmatterInvalidFor = (
  issues: readonly { analyzerId: string; nodeIds: readonly string[] }[],
  path: string,
) => issues.filter((i) => i.analyzerId === 'frontmatter-invalid' && i.nodeIds.includes(path));

describe('agent-skills `name` rules (open-standard frontmatter, end-to-end through runScan)', () => {
  it('flags a skill whose name breaks the open-standard pattern under the agent-skills lens', async () => {
    const result = await scan('agent-skills');
    const issues = frontmatterInvalidFor(result.issues, '.agents/skills/bad-name/SKILL.md');
    assert.equal(issues.length, 1, 'expected one frontmatter-invalid on the bad-name skill');
    // Default (non-strict) scan surfaces the per-kind schema failure as `warn`.
    assert.equal((issues[0] as unknown as { severity: string }).severity, 'warn');
  });

  it('does NOT flag a conforming skill under the agent-skills lens', async () => {
    const result = await scan('agent-skills');
    assert.equal(frontmatterInvalidFor(result.issues, '.agents/skills/good-skill/SKILL.md').length, 0);
  });
});
