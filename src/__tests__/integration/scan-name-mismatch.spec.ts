/**
 * End-to-end coverage for the `identifierMismatch` knob and the
 * two-tier `name-collision` verdict, through a real `runScan` with the
 * shipped built-ins (spec §Provider · kind identifiers · Identifier
 * agreement / Name collisions).
 *
 * Asserted properties:
 *
 *   1. An open-standard skill whose `name` diverges from its parent
 *      dirname → `name-mismatch` warn (the standard REQUIRES agreement).
 *   2. Claude surfaces (skill dirname, agent filename) → `info` (the
 *      override is documented-legal, but the node answers to both).
 *   3. Matching names, including case / separator variants that
 *      normalise together, stay clean.
 *   4. A declared name colliding with ANOTHER node's filename →
 *      `name-collision` warn (mixed bucket); two declared names still
 *      escalate to `error`.
 *   5. Warn / info verdicts never flip the scan into issues-exit.
 *   6. An incremental re-scan (priorSnapshot + cache) reproduces the
 *      same verdicts: analyzers re-run over cache-hydrated nodes whose
 *      frontmatter comes from the DB snapshot.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import type { ScanResult } from '../../kernel/index.js';
import { builtIns } from '../../plugins/built-ins.js';

let root: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNode(fixture: string, rel: string, body: string): void {
  const full = join(fixture, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

const md = (name: string): string => `---\nname: ${name}\ndescription: A test node.\n---\nbody\n`;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-name-mismatch-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

async function scan(fixture: string, activeProvider?: string): Promise<ScanResult> {
  const kernel = createKernel();
  return runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    ...(activeProvider ? { activeProvider } : {}),
  });
}

const mismatchesFor = (result: ScanResult, path: string) =>
  result.issues.filter((i) => i.analyzerId === 'name-mismatch' && i.nodeIds.includes(path));

describe('name-mismatch (end-to-end)', () => {
  it('open-standard skill with name != dirname → warn', async () => {
    const fixture = freshFixture('as-warn');
    writeNode(fixture, '.agents/skills/deploy/SKILL.md', md('deploy-tool'));
    const result = await scan(fixture, 'agent-skills');
    const issues = mismatchesFor(result, '.agents/skills/deploy/SKILL.md');
    assert.equal(issues.length, 1, `expected one mismatch; got: ${JSON.stringify(result.issues)}`);
    assert.equal(issues[0]!.severity, 'warn');
    assert.deepEqual(issues[0]!.data, {
      declaredName: 'deploy-tool',
      derivedName: 'deploy',
      derivedSource: 'dirname',
    });
  });

  it('claude skill with name != dirname → info (documented override)', async () => {
    const fixture = freshFixture('claude-skill');
    writeNode(fixture, '.claude/skills/deploy/SKILL.md', md('deploy-tool'));
    const result = await scan(fixture, 'claude');
    const issues = mismatchesFor(result, '.claude/skills/deploy/SKILL.md');
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.severity, 'info');
  });

  it('claude agent with name != filename stem → info', async () => {
    const fixture = freshFixture('claude-agent');
    writeNode(fixture, '.claude/agents/reviewer.md', md('architect'));
    const result = await scan(fixture, 'claude');
    const issues = mismatchesFor(result, '.claude/agents/reviewer.md');
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.severity, 'info');
    assert.match(issues[0]!.message, /filename stem/);
  });

  it('matching or normalization-equivalent names stay clean', async () => {
    const fixture = freshFixture('clean');
    writeNode(fixture, '.claude/agents/reviewer.md', md('reviewer'));
    // `My_Skill` vs dirname `my-skill` normalise to the same handle.
    writeNode(fixture, '.claude/skills/my-skill/SKILL.md', md('My_Skill'));
    const result = await scan(fixture, 'claude');
    const issues = result.issues.filter((i) => i.analyzerId === 'name-mismatch');
    assert.equal(issues.length, 0, `expected clean; got: ${JSON.stringify(issues)}`);
  });

  it('warn / info verdicts do not flip the scan into issue-exit severity', async () => {
    const fixture = freshFixture('exit');
    writeNode(fixture, '.claude/agents/reviewer.md', md('architect'));
    const result = await scan(fixture, 'claude');
    assert.ok(result.issues.some((i) => i.analyzerId === 'name-mismatch'));
    assert.equal(
      result.issues.some((i) => i.severity === 'error'),
      false,
      'no error-tier issue expected',
    );
  });

  it('incremental re-scan reproduces the verdicts from cache-hydrated nodes', async () => {
    const fixture = freshFixture('incremental');
    writeNode(fixture, '.claude/agents/reviewer.md', md('architect'));
    const first = await scan(fixture, 'claude');
    assert.equal(mismatchesFor(first, '.claude/agents/reviewer.md').length, 1);
    const kernel = createKernel();
    const second = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
      activeProvider: 'claude',
      priorSnapshot: first,
      enableCache: true,
    });
    const again = mismatchesFor(second, '.claude/agents/reviewer.md');
    assert.equal(again.length, 1, `expected the verdict to survive; got: ${JSON.stringify(second.issues)}`);
    assert.equal(again[0]!.severity, 'info');
  });
});

describe('name-collision two tiers (end-to-end)', () => {
  it('declared name colliding with another node filename → warn (mixed bucket)', async () => {
    const fixture = freshFixture('shadow');
    // reviewer.md DECLARES `architect`; architect.md claims `architect`
    // via its filename (its own declared name is distinct).
    writeNode(fixture, '.claude/agents/reviewer.md', md('architect'));
    writeNode(fixture, '.claude/agents/architect.md', md('architect2'));
    const result = await scan(fixture, 'claude');
    const collisions = result.issues.filter((i) => i.analyzerId === 'name-collision');
    assert.equal(collisions.length, 1, `expected one collision; got: ${JSON.stringify(collisions)}`);
    assert.equal(collisions[0]!.severity, 'warn');
    assert.match(collisions[0]!.message, /shadowing/);
    assert.deepEqual(
      [...collisions[0]!.nodeIds].sort(),
      ['.claude/agents/architect.md', '.claude/agents/reviewer.md'],
    );
  });

  it('two declared names still collide as error', async () => {
    const fixture = freshFixture('declared');
    writeNode(fixture, '.claude/agents/a.md', md('deploy'));
    writeNode(fixture, '.claude/agents/b.md', md('deploy'));
    const result = await scan(fixture, 'claude');
    const collisions = result.issues.filter((i) => i.analyzerId === 'name-collision');
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0]!.severity, 'error');
  });

  it('two plain markdown files sharing a basename stay silent', async () => {
    const fixture = freshFixture('md-twins');
    writeNode(fixture, 'docs/readme.md', 'plain body\n');
    writeNode(fixture, 'src/readme.md', 'plain body\n');
    const result = await scan(fixture, 'claude');
    const collisions = result.issues.filter((i) => i.analyzerId === 'name-collision');
    assert.equal(collisions.length, 0);
  });
});
