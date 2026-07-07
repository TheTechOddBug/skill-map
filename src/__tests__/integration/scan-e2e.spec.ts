/**
 * End-to-end scan test. Proves the orchestrator + claude provider + the
 * three extractors + the three rules work together on a realistic
 * fixture. Hits the orchestrator directly (not through the CLI) so the
 * assertions can inspect intermediate state the CLI only exposes as JSON.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';

let fixture: string;

before(async () => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-e2e-'));
  const write = (rel: string, content: string) => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  write(
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      '---',
      '',
      'Run /deploy or /unknown, consult @backend-lead. See [deploy](../commands/deploy.md).',
    ].join('\n'),
  );
  write(
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: Deploy', '---', 'Deploy body.'].join('\n'),
  );
  write(
    '.claude/commands/rollback.md',
    ['---', 'name: Rollback', '---', 'Rollback body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('scan end-to-end', () => {
  it('produces nodes, links, and issues from the full pipeline', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    strictEqual(result.schemaVersion, 1);
    strictEqual(result.stats.nodesCount, 3);

    const pathsByKind = result.nodes
      .map((n) => ({ path: n.path, kind: n.kind }))
      .sort((a, b) => a.path.localeCompare(b.path));
    deepStrictEqual(pathsByKind, [
      { path: '.claude/agents/architect.md', kind: 'agent' },
      { path: '.claude/commands/deploy.md', kind: 'command' },
      { path: '.claude/commands/rollback.md', kind: 'command' },
    ]);

    // Every node has sha256 hashes and triple-split bytes.
    for (const node of result.nodes) {
      strictEqual(node.bodyHash.length, 64);
      strictEqual(node.frontmatterHash.length, 64);
      ok(node.bytes.total === node.bytes.frontmatter + node.bytes.body);
      strictEqual(node.provider, 'claude');
    }

    // Links: markdown-link to deploy + slash /deploy + slash /unknown + at @backend-lead.
    const linkSummaries = result.links.map((l) => `${l.source}|${l.kind}|${l.target}`).sort();
    ok(linkSummaries.includes('.claude/agents/architect.md|references|.claude/commands/deploy.md'));
    ok(linkSummaries.some((s) => s.startsWith('.claude/agents/architect.md|invokes|/deploy')));
    ok(linkSummaries.some((s) => s.startsWith('.claude/agents/architect.md|invokes|/unknown')));
    ok(linkSummaries.some((s) => s.startsWith('.claude/agents/architect.md|mentions|@backend-lead')));

    // Issues: reference-broken for /unknown + @backend-lead.
    const issueIds = result.issues.map((i) => i.analyzerId).sort();
    ok(issueIds.includes('reference-broken'));

    // Link counts denormalised onto nodes.
    const architect = result.nodes.find((n) => n.path === '.claude/agents/architect.md');
    ok(architect);
    ok((architect?.linksOutCount ?? 0) >= 3, 'architect emits ≥3 outbound links');
    const deploy = result.nodes.find((n) => n.path === '.claude/commands/deploy.md');
    ok(deploy);
    ok((deploy?.linksInCount ?? 0) >= 1, 'deploy receives the markdown-link edge');
  });

  it('lifts resolved invocation links to confidence 1.0 in a real scan flow', async () => {
    // Regression guard for the buildProviderIndexes bug: the post-walk
    // `liftResolvedLinkConfidence` transform reads its ctx from the
    // providers list threaded through `runScan`, NOT from the
    // kernel.registry (which only stores `toExtensionRow()`-stripped
    // manifests with no `kinds` / `resolution` / `reservedNames`). The
    // dedicated unit test for the transform builds the ctx by hand and
    // therefore does not exercise the wiring; this test does.
    //
    // Asserts: `/deploy` from architect.md (resolves to the deploy command
    // node) keeps the kernel's 1.0 baseline (no penalty), while `/unknown`
    // (no target) and `@backend-lead` (no target) are genuinely broken and
    // fold to the broken floor (1.0 - BROKEN_PENALTY = 0.25).
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });
    const findLink = (kind: string, target: string) =>
      result.links.find(
        (l) => l.source === '.claude/agents/architect.md' && l.kind === kind && l.target === target,
      );
    const deployInvoke = findLink('invokes', '/deploy');
    ok(deployInvoke, 'expected /deploy invokes link from architect');
    strictEqual(deployInvoke!.confidence, 1.0, '/deploy resolves to the deploy command: keeps the kernel 1.0 baseline (no penalty)');
    const unknownInvoke = findLink('invokes', '/unknown');
    ok(unknownInvoke, 'expected /unknown invokes link from architect');
    strictEqual(unknownInvoke!.confidence, 0.25, '/unknown is genuinely broken: kernel 1.0 baseline minus BROKEN_PENALTY → 0.25');
    const backendMention = findLink('mentions', '@backend-lead');
    ok(backendMention, 'expected @backend-lead mentions link from architect');
    strictEqual(backendMention!.confidence, 0.25, '@backend-lead is genuinely broken: kernel 1.0 baseline minus BROKEN_PENALTY → 0.25');
  });

  it('does not flag a link whose target exists on disk but is not an indexed node', async () => {
    // The existence probe (third clause of the genuinely-broken
    // definition): `[schema](./report.schema.json)` points at a real
    // file the scan never indexes, so it must neither flag
    // `reference-broken` nor take the broken penalty. The sibling link to
    // `./missing.json` exists nowhere and keeps both. Requires the
    // `cwd` anchor: without it the probe stays off (the shared-fixture
    // tests above run without `cwd` and pin that degraded behaviour).
    const probeFixture = mkdtempSync(join(tmpdir(), 'skill-map-e2e-probe-'));
    try {
      writeFileSync(
        join(probeFixture, 'guide.md'),
        [
          '---',
          'name: guide',
          'description: Fixture for the existence probe',
          '---',
          '',
          'Shape in [the schema](./report.schema.json).',
          'History in [the old dump](./missing.json).',
        ].join('\n'),
      );
      writeFileSync(join(probeFixture, 'report.schema.json'), '{}');

      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
      const result = await runScan(kernel, {
        roots: [probeFixture],
        extensions: builtIns(),
        cwd: probeFixture,
      });

      strictEqual(result.stats.nodesCount, 1, 'the .json files are never indexed as nodes');
      const schemaRef = result.links.find((l) => l.target === 'report.schema.json');
      ok(schemaRef, 'expected the references link to the existing schema file');
      strictEqual(schemaRef!.confidence, 1.0, 'existing on disk: keeps the 1.0 baseline');
      const missingRef = result.links.find((l) => l.target === 'missing.json');
      ok(missingRef, 'expected the references link to the missing file');
      strictEqual(missingRef!.confidence, 0.25, 'exists nowhere: folds to the broken floor');

      const brokenIssues = result.issues.filter((i) => i.analyzerId === 'reference-broken');
      strictEqual(brokenIssues.length, 1, 'only the missing target flags');
      strictEqual((brokenIssues[0]!.data as { target?: string }).target, 'missing.json');
    } finally {
      rmSync(probeFixture, { recursive: true, force: true });
    }
  });

  it('produces zero-filled result with --no-built-ins parity (empty extensions)', async () => {
    const kernel = createKernel();
    const result = await runScan(kernel, { roots: [fixture] });
    strictEqual(result.stats.nodesCount, 0);
    strictEqual(result.stats.linksCount, 0);
    strictEqual(result.stats.issuesCount, 0);
  });

  it('computes token counts by default', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    strictEqual(result.nodes.length > 0, true);
    for (const node of result.nodes) {
      ok(node.tokens, `node ${node.path} missing tokens`);
      const { frontmatter, body, total } = node.tokens;
      ok(Number.isInteger(frontmatter) && frontmatter >= 0, 'frontmatter token count is a non-negative integer');
      ok(Number.isInteger(body) && body >= 0, 'body token count is a non-negative integer');
      ok(Number.isInteger(total) && total >= 0, 'total token count is a non-negative integer');
      strictEqual(total, frontmatter + body);
      // Every fixture has both a frontmatter block and a body, so both
      // token counts must be strictly positive.
      ok(frontmatter > 0, `node ${node.path} expected frontmatter tokens > 0`);
      ok(body > 0, `node ${node.path} expected body tokens > 0`);
    }
  });

  it('skips tokenization with `tokenize: false`', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
      tokenize: false,
    });

    strictEqual(result.nodes.length > 0, true);
    for (const node of result.nodes) {
      strictEqual(node.tokens, undefined, `node ${node.path} should not have tokens`);
    }
  });

  it('counts external URLs into externalRefsCount and strips pseudo-links from result.links', async () => {
    // Isolated fixture so the per-node counts in this test don't depend
    // on the shared one above.
    const local = mkdtempSync(join(tmpdir(), 'skill-map-e2e-urls-'));
    try {
      const writeLocal = (rel: string, content: string) => {
        const abs = join(local, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
      };
      // Two distinct URLs (https://example.com and https://example.com/path)
      // + one duplicate of the first + one syntactically invalid URL that
      // `new URL()` rejects. Expected externalRefsCount: 2.
      writeLocal(
        '.claude/agents/links.md',
        [
          '---',
          'name: links',
          'description: Has external URLs',
          '---',
          '',
          'See https://example.com for the docs.',
          'Also [more](https://example.com/path).',
          'Already mentioned https://example.com above.',
          'Bad: https://[bad here.',
        ].join('\n'),
      );

      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

      const result = await runScan(kernel, {
        roots: [local],
        extensions: builtIns(),
      });

      const links = result.nodes.find((n) => n.path === '.claude/agents/links.md');
      ok(links, 'links node was scanned');
      strictEqual(links!.externalRefsCount, 2, 'two distinct normalized URLs counted');
      // No external pseudo-link survives in result.links.
      const externalSurvivors = result.links.filter(
        (l) => l.target.startsWith('http://') || l.target.startsWith('https://'),
      );
      strictEqual(externalSurvivors.length, 0, 'external pseudo-links were stripped');
      // linksOutCount reflects ONLY internal extractors (frontmatter + slash + at).
      // This fixture has no frontmatter references, no slash commands, no @handles,
      // so linksOutCount must be 0, untouched by the URL counter.
      strictEqual(links!.linksOutCount, 0, 'URL counter does not inflate linksOutCount');
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });

  it('extracts backtick code-region paths: path-match lift, points/references coexistence, broken flag', async () => {
    // Isolated fixture: a skill whose body references its bundled docs the
    // way agent-authored skills do, backtick-wrapped relative paths in
    // prose and inside a fenced block (`core/backtick-path` territory),
    // plus one prose markdown link to the same target as a backticked one
    // so the points/references coexistence (Decision #127: two rows, no
    // merge, no link-kind-conflict warn) is locked end-to-end.
    const local = mkdtempSync(join(tmpdir(), 'skill-map-e2e-backtick-'));
    try {
      const writeLocal = (rel: string, content: string) => {
        const abs = join(local, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
      };
      writeLocal(
        '.claude/skills/demo/SKILL.md',
        [
          '---',
          'name: demo',
          'description: Backtick code-region path demo',
          '---',
          '',
          'Read `references/rules.md` before doing anything else.',
          'See [the guide](references/guide.md) and validate with:',
          '```bash',
          'check --rules references/guide.md --extra references/missing.md',
          '```',
        ].join('\n'),
      );
      writeLocal('.claude/skills/demo/references/rules.md', '# Rules\n\nThe rules body.');
      writeLocal('.claude/skills/demo/references/guide.md', '# Guide\n\nThe guide body.');

      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
      const result = await runScan(kernel, { roots: [local], extensions: builtIns() });

      const src = '.claude/skills/demo/SKILL.md';
      const find = (target: string, kind: string) =>
        result.links.filter((l) => l.source === src && l.kind === kind && l.target === target);

      // 1) Backtick-only path resolving to a scanned markdown node emits a
      //    `points` link and lifts to 1.0 via the universal path-match rule.
      const rules = find('.claude/skills/demo/references/rules.md', 'points');
      strictEqual(rules.length, 1, 'one points link to references/rules.md');
      strictEqual(rules[0]!.confidence, 1.0, 'resolved backtick path lifts to 1.0');
      strictEqual(rules[0]!.sources[0], 'backtick-path');

      // 2) Prose markdown link + backticked path to the SAME target COEXIST
      //    as two rows (kinds differ, the dedup keys on kind): one
      //    `references` from markdown-link, one `points` from backtick-path.
      const guideRef = find('.claude/skills/demo/references/guide.md', 'references');
      strictEqual(guideRef.length, 1, 'one references link from the prose markdown link');
      strictEqual(guideRef[0]!.sources[0], 'markdown-link');
      ok(!guideRef[0]!.sources.includes('backtick-path'), 'sources are NOT unioned across kinds');
      strictEqual(guideRef[0]!.confidence, 1.0);
      const guidePts = find('.claude/skills/demo/references/guide.md', 'points');
      strictEqual(guidePts.length, 1, 'one points link from the backticked path');
      strictEqual(guidePts[0]!.sources[0], 'backtick-path');
      strictEqual(guidePts[0]!.confidence, 1.0);
      // The coexisting pair is compatible by design: no link-kind-conflict warn.
      const conflicts = result.issues.filter(
        (i) => i.analyzerId === 'link-kind-conflict' && i.nodeIds.includes(src),
      );
      strictEqual(conflicts.length, 0, 'points + references on one pair is not a conflict');

      // 3) Backticked path to a missing file persists (the chosen
      //    contract: broken detection over silent drop) and is demoted to
      //    the broken floor, plus flagged by reference-broken.
      const missing = find('.claude/skills/demo/references/missing.md', 'points');
      strictEqual(missing.length, 1, 'unresolved backtick path persists');
      strictEqual(missing[0]!.confidence, 0.25, 'genuinely-broken backtick path: kernel 1.0 baseline minus BROKEN_PENALTY → 0.25');
      const broken = result.issues.filter(
        (i) => i.analyzerId === 'reference-broken' && i.nodeIds.includes(src),
      );
      ok(broken.length >= 1, 'reference-broken flags the missing backtick target');
      ok(
        broken.some((i) => `${i.message} ${i.detail ?? ''}`.includes('references/missing.md')),
        'the broken issue names the missing target',
      );
      ok(
        broken.some((i) => i.message.includes('pointer')),
        'the broken issue uses the points kind label',
      );
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });
});
