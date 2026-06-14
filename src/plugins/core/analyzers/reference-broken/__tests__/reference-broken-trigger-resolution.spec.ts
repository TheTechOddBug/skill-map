/**
 * Regression test, the `reference-broken` rule MUST resolve invocation-style
 * triggers (`/foo`, `@bar`) against advertised `frontmatter.name` of any
 * scanned node. Fired during Step 9 manual QA when `/deploy` falsely
 * tripped broken-ref despite a `deploy.md` with `name: deploy` in the
 * scan: the original incident was the heredoc-paste auto-indent bug
 * (now caught by `frontmatter-malformed` in Step 9 follow-up), but the
 * resolution semantic itself was never asserted in isolation. This file
 * locks the contract:
 *
 *   - `/deploy` link resolves to a node where `frontmatter.name === 'deploy'`
 *   - `@architect` link resolves to a node where `frontmatter.name === 'architect'`
 *   - Trigger normalisation applies on both sides (case, hyphens, accents)
 *   - Path-style targets (`.claude/commands/foo.md`) still resolve via
 *     verbatim path lookup (frontmatter extractor path)
 *   - When neither path lookup nor name index matches, broken-ref fires.
 *
 * The rule has unit-level coverage via the orchestrator-level scan test
 * (scan-readers.test.ts builds a fixture that exercises broken-ref +2
 * times by design). Those tests prove the rule fires on intentionally
 * unresolvable refs; this file proves the inverse, that genuinely
 * resolvable refs DON'T fire.
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../../../../../kernel/index.js';
import { builtIns } from '../../../../built-ins.js';

let tmpRoot: string;
let counter = 0;

function freshFixture(label: string): string {
  counter += 1;
  const dir = join(tmpRoot, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNode(fixture: string, rel: string, content: string): void {
  const full = join(fixture, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-broken-ref-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function scan(fixture: string) {
  const kernel = createKernel();
  // `activeProvider: 'claude'` is required so the provider-gated
  // `claude/at-directive` and `claude/slash-command` extractors run against
  // the `.claude/*` fixtures. The kernel's runtime callers
  // (scan-runner) auto-resolve this from filesystem markers; tests
  // that bypass the runtime declare it explicitly.
  return runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    activeProvider: 'claude',
  });
}

describe('broken-ref, trigger resolution against frontmatter.name', () => {
  it('/deploy resolves to a command whose frontmatter.name is "deploy"', async () => {
    const fixture = freshFixture('slash-resolved');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: Architect.',
        '---',
        '',
        'Use /deploy when the build is green.',
      ].join('\n'),
    );
    writeNode(
      fixture,
      '.claude/commands/deploy.md',
      [
        '---',
        'name: deploy',
        'description: Deploy command.',
        '---',
        '',
        'Deploy body.',
      ].join('\n'),
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.analyzerId === 'reference-broken');
    const slashIssue = brokenRefs.find(
      (i) => typeof i.data?.['trigger'] === 'string' && (i.data['trigger'] as string).includes('deploy'),
    );
    assert.equal(
      slashIssue,
      undefined,
      `/deploy must NOT trigger broken-ref when a node advertises name: deploy.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('@architect resolves to an agent whose frontmatter.name is "architect"', async () => {
    const fixture = freshFixture('at-resolved');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      '---\nname: architect\ndescription: A.\n---\nbody\n',
    );
    writeNode(
      fixture,
      '.claude/skills/explorer.md',
      '---\nname: explorer\ndescription: E.\n---\nConsult @architect for review.\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.analyzerId === 'reference-broken');
    assert.equal(
      brokenRefs.length,
      0,
      `@architect must resolve when an agent advertises name: architect.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('genuinely unresolvable trigger DOES fire broken-ref', async () => {
    const fixture = freshFixture('unresolved');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      '---\nname: architect\ndescription: A.\n---\nUse /missing-command somewhere.\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.analyzerId === 'reference-broken');
    assert.equal(brokenRefs.length, 1, 'expected exactly 1 broken-ref');
    assert.match(brokenRefs[0]!.message, /\/missing-command/);
  });

  it('case-insensitive name matching (Architect ↔ /architect)', async () => {
    const fixture = freshFixture('case');
    writeNode(
      fixture,
      '.claude/agents/Architect.md',
      '---\nname: Architect\ndescription: A.\n---\nbody\n',
    );
    writeNode(
      fixture,
      '.claude/skills/explorer.md',
      '---\nname: explorer\ndescription: E.\n---\nMention @architect (lowercase).\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.analyzerId === 'reference-broken');
    assert.equal(
      brokenRefs.length,
      0,
      `Case-insensitive normalisation should resolve @architect to name=Architect.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('hyphen-vs-space normalisation (name: "build deploy" ↔ /build-deploy)', async () => {
    const fixture = freshFixture('hyphen');
    writeNode(
      fixture,
      '.claude/commands/build-deploy.md',
      '---\nname: build deploy\ndescription: B.\n---\nbody\n',
    );
    writeNode(
      fixture,
      '.claude/skills/explorer.md',
      '---\nname: explorer\ndescription: E.\n---\nRun /build-deploy when ready.\n',
    );

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.analyzerId === 'reference-broken');
    assert.equal(
      brokenRefs.length,
      0,
      `normalizeTrigger must equate "build deploy" with "build-deploy".\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('path-style target (annotations extractor) still uses verbatim path lookup', async () => {
    const fixture = freshFixture('path');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      ['---', 'name: architect', 'description: A.', '---', 'body'].join('\n'),
    );
    writeNode(
      fixture,
      '.claude/commands/deploy.md',
      '---\nname: deploy\ndescription: D.\n---\nbody\n',
    );
    await writeAnnotationsSidecar(fixture, '.claude/agents/architect.md', {
      supersedes: ['.claude/commands/deploy.md'],
    });

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.analyzerId === 'reference-broken');
    assert.equal(
      brokenRefs.length,
      0,
      `annotations.supersedes path resolves verbatim to .claude/commands/deploy.md.\n` +
        `Issues: ${JSON.stringify(brokenRefs, null, 2)}`,
    );
  });

  it('path-style target that does NOT exist fires broken-ref', async () => {
    const fixture = freshFixture('path-missing');
    writeNode(
      fixture,
      '.claude/agents/architect.md',
      ['---', 'name: architect', 'description: A.', '---', 'body'].join('\n'),
    );
    await writeAnnotationsSidecar(fixture, '.claude/agents/architect.md', {
      supersedes: ['.claude/commands/does-not-exist.md'],
    });

    const result = await scan(fixture);
    const brokenRefs = result.issues.filter((i) => i.analyzerId === 'reference-broken');
    assert.equal(brokenRefs.length, 1);
    assert.match(brokenRefs[0]!.message, /does-not-exist\.md/);
  });
});

/**
 * Helper: capture real `body` / `frontmatter` hashes via a baseline
 * scan, then write a co-located `.sm` sidecar with the given
 * annotations block. Used by tests that exercise the `core/annotations`
 * extractor through the sidecar surface (the only surface, post-fallback-drop).
 */
async function writeAnnotationsSidecar(
  fixture: string,
  nodeRel: string,
  annotations: Record<string, unknown>,
): Promise<void> {
  const baseline = await scan(fixture);
  const node = baseline.nodes.find((n) => n.path === nodeRel);
  assert.ok(node, `baseline scan must include ${nodeRel}`);
  const sidecarRel = nodeRel.replace(/\.md$/, '.sm');
  const lines = ['identity:', `  path: ${nodeRel}`, `  bodyHash: ${node!.bodyHash}`, `  frontmatterHash: ${node!.frontmatterHash}`, 'annotations:'];
  for (const [key, value] of Object.entries(annotations)) {
    if (Array.isArray(value)) {
      lines.push(`  ${key}:`);
      for (const v of value) lines.push(`    - ${String(v)}`);
    } else {
      lines.push(`  ${key}: ${String(value)}`);
    }
  }
  writeNode(fixture, sidecarRel, lines.join('\n') + '\n');
}
