/**
 * Integration: code-region triggers end-to-end through the real scan
 * pipeline (`claude/backtick-mention` + `core/backtick-slash` + the
 * `prune-unresolved-code-triggers` post-walk gate, over the
 * priority-ordered claude resolution matrix). Normative contract:
 * `spec/architecture.md` §Extractor · code-region triggers +
 * §Provider · resolution rules (Decisions #134 / #135).
 *
 * The unit specs pin each half in isolation (each extractor's grammar
 * and context tagging, the gate's filter rule); this spec pins the
 * composition the operator actually experiences:
 *
 *   - a backticked `@reviewer` naming a real agent becomes ONE
 *     `mentions` edge, resolved and lifted to 1.0;
 *   - backticked `@deploy-site` / `@playbook` resolve through the
 *     widened claude matrix to a SKILL and a plain MARKDOWN file;
 *   - a backticked `/deploy-site` becomes an `invokes` edge to the
 *     skill; a backticked shell path (`/tmp`) is pruned;
 *   - backticked npm-scope / decorator bait resolves to nothing and is
 *     PRUNED: no link, and crucially no `reference-broken` error;
 *   - a handle mentioned BOTH in prose and in backticks merges into one
 *     link whose prose occurrence vetoes the prune, so an unresolved
 *     one keeps the standing dangling-is-broken behaviour.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan, type ScanResult } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';

let fixture: string;
let result: ScanResult;

before(async () => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-backtick-triggers-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };

  write(
    '.claude/agents/reviewer.md',
    ['---', 'name: reviewer', 'description: Reviews the final output.', '---', '', 'Review it.'].join('\n'),
  );
  write(
    '.claude/skills/deploy-site/SKILL.md',
    ['---', 'name: deploy-site', 'description: Deploys the site.', '---', '', 'Deploy it.'].join('\n'),
  );
  write('docs/playbook.md', '# Playbook\n\nOperational notes.\n');

  // Backticked mention of a REAL agent (span + fenced repeat, dedupes)
  // next to backticked npm-scope bait that must be pruned.
  write(
    'uses-code.md',
    [
      'Hand the draft to `@reviewer` when done.',
      '',
      '```text',
      '@reviewer check the draft.',
      '```',
      '',
      'Install `@changesets/cli` before publishing.',
    ].join('\n'),
  );
  // The widened matrix + slash sibling: skill mention, markdown
  // mention, skill invocation, and a shell-path bait for the gate.
  write(
    'uses-more.md',
    [
      'Start with `@deploy-site` and keep `@playbook` at hand.',
      '',
      'Then run `/deploy-site` and never write to `/killdb`.',
    ].join('\n'),
  );
  // The same UNRESOLVED handle in prose AND in a span: the merged link
  // must survive the gate (prose occurrence = authored intent).
  write('uses-both.md', 'Ping @ghost about this, then re-run `@ghost` if it stalls.');

  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  result = await runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    activeProvider: 'claude',
  });
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('backtick triggers through the full scan pipeline (claude lens)', () => {
  it('a backticked handle naming a real agent becomes one resolved mentions edge', () => {
    const links = result.links.filter(
      (l) => l.source === 'uses-code.md' && l.kind === 'mentions',
    );
    strictEqual(links.length, 1);
    const link = links[0]!;
    strictEqual(link.target, '@reviewer');
    strictEqual(link.resolvedTarget, '.claude/agents/reviewer.md');
    strictEqual(link.confidence, 1.0);
    deepStrictEqual(link.sources, ['backtick-mention']);
    strictEqual(link.occurrences?.[0]?.context, 'inline-code');
  });

  it('backticked mentions resolve to a skill and to a plain markdown file via the widened matrix', () => {
    const bySkill = result.links.find(
      (l) => l.source === 'uses-more.md' && l.kind === 'mentions' && l.target === '@deploy-site',
    );
    strictEqual(bySkill?.resolvedTarget, '.claude/skills/deploy-site/SKILL.md');
    const byDoc = result.links.find(
      (l) => l.source === 'uses-more.md' && l.kind === 'mentions' && l.target === '@playbook',
    );
    strictEqual(byDoc?.resolvedTarget, 'docs/playbook.md');
  });

  it('a backticked slash invocation resolves to the skill; a shell path is pruned', () => {
    const invokes = result.links.filter(
      (l) => l.source === 'uses-more.md' && l.kind === 'invokes',
    );
    strictEqual(invokes.length, 1);
    const link = invokes[0]!;
    strictEqual(link.target, '/deploy-site');
    strictEqual(link.resolvedTarget, '.claude/skills/deploy-site/SKILL.md');
    deepStrictEqual(link.sources, ['backtick-slash']);
    strictEqual(link.occurrences?.[0]?.context, 'inline-code');
    strictEqual(result.links.some((l) => l.target === '/killdb'), false);
  });

  it('unresolved backticked bait is pruned: no link AND no reference-broken error', () => {
    const baitLinks = result.links.filter((l) => l.target.includes('changesets'));
    strictEqual(baitLinks.length, 0);
    const baitIssues = result.issues.filter(
      (i) =>
        i.analyzerId === 'reference-broken' &&
        (i.nodeIds.includes('uses-code.md') || i.nodeIds.includes('uses-more.md')),
    );
    deepStrictEqual(baitIssues, []);
  });

  it('prose + backtick occurrences of one unresolved handle merge, survive the gate, and flag broken', () => {
    const links = result.links.filter(
      (l) => l.source === 'uses-both.md' && l.kind === 'mentions',
    );
    strictEqual(links.length, 1);
    const link = links[0]!;
    strictEqual(link.target, '@ghost');
    strictEqual(link.resolvedTarget ?? null, null);
    // Both extractors contributed; the prose occurrence has no context,
    // which is exactly what vetoes the prune.
    deepStrictEqual([...link.sources].sort(), ['at-directive', 'backtick-mention']);
    strictEqual(link.occurrences?.length, 2);
    ok(link.occurrences!.some((o) => !o.context));
    ok(link.occurrences!.some((o) => o.context === 'inline-code'));
    const ghostIssues = result.issues.filter(
      (i) => i.analyzerId === 'reference-broken' && i.nodeIds.includes('uses-both.md'),
    );
    strictEqual(ghostIssues.length, 1);
  });
});

describe('backtick triggers through the full scan pipeline (codex lens)', () => {
  let codexFixture: string;
  let codexResult: ScanResult;

  before(async () => {
    codexFixture = mkdtempSync(join(tmpdir(), 'skill-map-backtick-dollar-'));
    const write = (rel: string, body: string): void => {
      const abs = join(codexFixture, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, body);
    };
    write(
      '.agents/skills/check-links/SKILL.md',
      ['---', 'name: check-links', 'description: Checks every link.', '---', '', 'Check them.'].join('\n'),
    );
    // A backticked skill invocation next to a lowercase shell-var bait
    // in a fence: the skill resolves, the var prunes.
    write(
      'notes.md',
      ['Run `$check-links` before shipping.', '', '```sh', 'for f in *.md; do echo $file; done', '```'].join('\n'),
    );
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    codexResult = await runScan(kernel, {
      roots: [codexFixture],
      extensions: builtIns(),
      activeProvider: 'codex',
    });
  });

  after(() => {
    rmSync(codexFixture, { recursive: true, force: true });
  });

  it('a backticked $skill resolves to the codex skill; the shell var is pruned', () => {
    const invokes = codexResult.links.filter((l) => l.kind === 'invokes');
    strictEqual(invokes.length, 1);
    const link = invokes[0]!;
    strictEqual(link.target, '$check-links');
    strictEqual(link.resolvedTarget, '.agents/skills/check-links/SKILL.md');
    deepStrictEqual(link.sources, ['backtick-dollar']);
    strictEqual(link.occurrences?.[0]?.context, 'inline-code');
    strictEqual(codexResult.links.some((l) => l.target === '$file'), false);
    deepStrictEqual(
      codexResult.issues.filter((i) => i.analyzerId === 'reference-broken'),
      [],
    );
  });
});
