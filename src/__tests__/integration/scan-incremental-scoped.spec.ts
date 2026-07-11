/**
 * Watcher chokidar-scoped incremental scan (`incrementalChangedPaths`).
 *
 * The watcher hands the orchestrator the EXACT changed-path set chokidar
 * reported, so the scan re-extracts only those files and reuses the prior
 * snapshot for everything else WITHOUT traversing the corpus (the ~93%
 * cost of a re-scan on a large tree). This exercises that path directly
 * by passing `incrementalChangedPaths` to `runScan`.
 *
 * Coverage:
 *   - A changed file is reprocessed; the merged result is set-equal to a
 *     full scan of the mutated fixture (the scoped merge loses nothing).
 *   - Unchanged siblings are reused (cached) from the prior.
 *   - A `removed` path drops from the merged result and broken-ref fires
 *     on dangling references to it.
 *   - A `.sm` sidecar edit (changed = the `.sm` path) re-resolves its
 *     `.md` node's annotations (the `.sm` -> `.md` mapping).
 *   - The scoped path NEVER reads an unchanged file: a prior node whose
 *     `.md` was deleted on disk but NOT reported by chokidar survives
 *     verbatim (proof the walker did not stat / read it). This also
 *     documents the chokidar-trust tradeoff.
 *
 * Uses temp file-based SQLite DBs (not `:memory:`, per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan, InMemoryProgressEmitter } from '../../kernel/index.js';
import type { ScanResult } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import type { ProgressEvent } from '../../kernel/ports/progress-emitter.js';

let tmpRoot: string;

function freshFixture(label: string): string {
  return mkdtempSync(join(tmpRoot, `${label}-`));
}

function writeFixtureFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

async function fullFixture(root: string): Promise<void> {
  writeFixtureFile(
    root,
    '.claude/agents/architect.md',
    [
      '---',
      'name: architect',
      'description: The architect',
      '---',
      '',
      'Run /deploy, consult @backend-lead.',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: Deploy', '---', 'Deploy body.'].join('\n'),
  );
  writeFixtureFile(
    root,
    '.claude/commands/rollback.md',
    ['---', 'name: Rollback', '---', 'Rollback body.'].join('\n'),
  );
}

async function fullScan(fixture: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScan(kernel, { roots: [fixture], extensions: builtIns() });
}

/**
 * Drive the chokidar-scoped path: pass `incrementalChangedPaths` so the
 * orchestrator enumerates from `prior` + reads only `changed`.
 */
async function scopedScan(
  fixture: string,
  prior: ScanResult,
  changed: readonly string[],
  removed: readonly string[] = [],
  emitter?: InMemoryProgressEmitter,
): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  const opts: Parameters<typeof runScan>[1] = {
    roots: [fixture],
    extensions: builtIns(),
    priorSnapshot: prior,
    enableCache: true,
    incrementalChangedPaths: { changed: new Set(changed), removed: new Set(removed) },
  };
  if (emitter) opts.emitter = emitter;
  return runScan(kernel, opts);
}

/**
 * Cached FULL walk: prior snapshot + `enableCache` but NO scoped-change set,
 * so the orchestrator traverses every root yet reuses cache-hit nodes. This
 * is the mode a `sm serve` boot / debounced rescan runs (distinct from the
 * chokidar-scoped incremental fast path `scopedScan` drives).
 */
async function cachedFullScan(fixture: string, prior: ScanResult): Promise<ScanResult> {
  const kernel = createKernel();
  for (const m of listBuiltIns()) kernel.registry.register(m);
  return runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    priorSnapshot: prior,
    enableCache: true,
  });
}

const linkKey = (l: { source: string; target: string; kind: string }): string =>
  `${l.source}|${l.kind}|${l.target}`;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-scoped-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('chokidar-scoped incremental scan', () => {
  it('reprocesses only the changed file and the merged result equals a full scan of the mutation', async () => {
    const fixture = freshFixture('changed');
    await fullFixture(fixture);
    const prior = await fullScan(fixture);
    const architectFirst = prior.nodes.find((n) => n.path === '.claude/agents/architect.md');
    ok(architectFirst);

    // Mutate one file. Its body now invokes /rollback instead of mentioning a handle.
    writeFixtureFile(
      fixture,
      '.claude/agents/architect.md',
      [
        '---',
        'name: architect',
        'description: The architect',
        '---',
        '',
        'Run /deploy and /rollback now.',
      ].join('\n'),
    );

    const events: ProgressEvent[] = [];
    const emitter = new InMemoryProgressEmitter();
    emitter.subscribe((e) => events.push(e));
    const scoped = await scopedScan(fixture, prior, ['.claude/agents/architect.md'], [], emitter);

    // Only the architect was re-extracted; its siblings stayed cached.
    const progress = events.filter((e) => e.type === 'scan.progress');
    const reprocessed = new Set<string>();
    const cached = new Set<string>();
    for (const ev of progress) {
      const d = ev.data as { cached: boolean; path: string };
      if (d.cached) cached.add(d.path);
      else reprocessed.add(d.path);
    }
    deepStrictEqual([...reprocessed].sort(), ['.claude/agents/architect.md']);
    ok(cached.has('.claude/commands/deploy.md'), 'deploy stayed cached');
    ok(cached.has('.claude/commands/rollback.md'), 'rollback stayed cached');

    // The architect node carries a fresh bodyHash; the merged result is
    // set-equal to a full scan of the mutated fixture (nothing lost).
    const architectScoped = scoped.nodes.find((n) => n.path === '.claude/agents/architect.md');
    ok(architectScoped && architectScoped.bodyHash !== architectFirst!.bodyHash);

    const fromFull = await fullScan(fixture);
    deepStrictEqual(
      scoped.nodes.map((n) => `${n.path}|${n.bodyHash}`).sort(),
      fromFull.nodes.map((n) => `${n.path}|${n.bodyHash}`).sort(),
      'scoped nodes set-equal to full scan',
    );
    deepStrictEqual(
      scoped.links.map(linkKey).sort(),
      fromFull.links.map(linkKey).sort(),
      'scoped links set-equal to full scan',
    );
    deepStrictEqual(
      scoped.issues.map((i) => i.analyzerId).sort(),
      fromFull.issues.map((i) => i.analyzerId).sort(),
      'scoped issues set-equal to full scan',
    );
  });

  it('drops a removed path and fires broken-ref on the dangling reference', async () => {
    const fixture = freshFixture('removed');
    await fullFixture(fixture);
    const prior = await fullScan(fixture);
    ok(prior.nodes.find((n) => n.path === '.claude/commands/deploy.md'));

    // Delete deploy.md and report it as a chokidar unlink.
    unlinkSync(join(fixture, '.claude/commands/deploy.md'));
    const scoped = await scopedScan(fixture, prior, [], ['.claude/commands/deploy.md']);

    ok(
      !scoped.nodes.find((n) => n.path === '.claude/commands/deploy.md'),
      'deploy dropped from the merged result',
    );
    const brokenRefs = scoped.issues.filter((i) => i.analyzerId === 'reference-broken');
    ok(
      brokenRefs.some((i) => i.nodeIds.includes('.claude/agents/architect.md')),
      'broken-ref fires on architect -> /deploy after deploy.md is removed',
    );
  });

  it('re-resolves a node when only its `.sm` sidecar changed (sidecar -> md mapping)', async () => {
    const fixture = freshFixture('sidecar');
    const nodePath = '.claude/agents/architect.md';
    const sidecarPath = '.claude/agents/architect.sm';
    writeFixtureFile(fixture, nodePath, ['---', 'name: architect', '---', 'Body.'].join('\n'));

    // First scan to learn the node's identity hashes: the sidecar schema
    // requires `identity.{path,bodyHash,frontmatterHash}`, so a sidecar
    // with a bare `path` fails validation and surfaces no annotations.
    const scan0 = await fullScan(fixture);
    const n0 = scan0.nodes.find((n) => n.path === nodePath)!;
    const writeSidecar = (note: string): void => {
      writeFixtureFile(
        fixture,
        sidecarPath,
        [
          'identity:',
          `  path: ${nodePath}`,
          `  bodyHash: ${n0.bodyHash}`,
          `  frontmatterHash: ${n0.frontmatterHash}`,
          'annotations:',
          `  note: ${note}`,
          '',
        ].join('\n'),
      );
    };

    writeSidecar('first');
    const prior = await fullScan(fixture);
    const archPrior = prior.nodes.find((n) => n.path === nodePath);
    strictEqual(
      (archPrior?.sidecar?.annotations as { note?: string } | null | undefined)?.note,
      'first',
    );

    // Edit only the sidecar; report the `.sm` path (chokidar watches it).
    writeSidecar('second');
    const scoped = await scopedScan(fixture, prior, [sidecarPath]);

    const archScoped = scoped.nodes.find((n) => n.path === nodePath);
    strictEqual(
      (archScoped?.sidecar?.annotations as { note?: string } | null | undefined)?.note,
      'second',
      'the `.sm` edit re-resolved the node sidecar via the .sm -> .md mapping',
    );
  });

  it('never reads an unchanged file: a prior node deleted on disk but NOT reported survives verbatim', async () => {
    const fixture = freshFixture('noread');
    await fullFixture(fixture);
    const prior = await fullScan(fixture);
    const rollbackPrior = prior.nodes.find((n) => n.path === '.claude/commands/rollback.md');
    ok(rollbackPrior);

    // Delete rollback.md from disk but do NOT report it (not in changed,
    // not in removed). The scoped walker must reuse it from the prior
    // WITHOUT touching the disk; a read would fail and drop it. This is
    // the proof of "no traversal / no stat of unchanged files" and also
    // documents the chokidar-trust tradeoff (a delete chokidar misses is
    // stale until the next full scan).
    unlinkSync(join(fixture, '.claude/commands/rollback.md'));

    // Touch an unrelated file as the only reported change.
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy.md',
      ['---', 'name: deploy', 'description: Deploy v2', '---', 'Deploy body v2.'].join('\n'),
    );
    const scoped = await scopedScan(fixture, prior, ['.claude/commands/deploy.md']);

    const rollbackScoped = scoped.nodes.find((n) => n.path === '.claude/commands/rollback.md');
    ok(rollbackScoped, 'rollback survives (reused from prior, never read from disk)');
    strictEqual(
      rollbackScoped!.bodyHash,
      rollbackPrior!.bodyHash,
      'rollback reused verbatim (same bodyHash, not re-read)',
    );
  });

  it('carries a virtual mcp node forward when its source is a cache hit', async () => {
    const fixture = freshFixture('mcp-virtual');
    // A skill whose `tools:` frontmatter references an MCP server with NO
    // config-side declaration (no `.mcp.json`): the `mcp://notion` node is
    // materialised purely by `core/mcp-tools`, a virtual, frontmatter-derived
    // node. This is the antigravity shape (that provider has no `mcpConfig`).
    writeFixtureFile(
      fixture,
      '.claude/skills/notion-publish/SKILL.md',
      [
        '---',
        'name: notion-publish',
        'description: Mirror pages to Notion.',
        'tools: [mcp__notion__notion-create-pages]',
        '---',
        'Create a page with `mcp__notion__notion-create-pages`.',
      ].join('\n'),
    );
    // An unrelated sibling so the incremental pass has a changed file to
    // process while the skill (the mcp node's source) stays a cache hit.
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy.md',
      ['---', 'name: deploy', 'description: Deploy', '---', 'Deploy body.'].join('\n'),
    );

    const prior = await fullScan(fixture);
    const mcpPrior = prior.nodes.find((n) => n.path === 'mcp://notion');
    ok(mcpPrior?.virtual === true, 'full scan materialises the virtual mcp node');

    // Change ONLY the unrelated command; the skill stays a cache hit, so
    // `core/mcp-tools` never re-runs for it and never re-emits the node.
    writeFixtureFile(
      fixture,
      '.claude/commands/deploy.md',
      ['---', 'name: deploy', 'description: Deploy v2', '---', 'Deploy body v2.'].join('\n'),
    );
    const scoped = await scopedScan(fixture, prior, ['.claude/commands/deploy.md']);

    ok(
      scoped.nodes.find((n) => n.path === 'mcp://notion'),
      'the virtual mcp node survives the incremental scan (carried forward from prior)',
    );
    ok(
      scoped.links.some(
        (l) =>
          l.source === '.claude/skills/notion-publish/SKILL.md' && l.target === 'mcp://notion',
      ),
      'the skill -> mcp://notion reference still resolves after the incremental scan',
    );
  });

  it('drops a virtual mcp node once its only source stops declaring the tool', async () => {
    const fixture = freshFixture('mcp-drop');
    writeFixtureFile(
      fixture,
      '.claude/skills/notion-publish/SKILL.md',
      [
        '---',
        'name: notion-publish',
        'description: Mirror pages to Notion.',
        'tools: [mcp__notion__notion-create-pages]',
        '---',
        'Body.',
      ].join('\n'),
    );
    const prior = await fullScan(fixture);
    ok(prior.nodes.find((n) => n.path === 'mcp://notion'), 'prior has the virtual mcp node');

    // Rewrite the skill WITHOUT the `tools:` frontmatter and report it
    // changed: the source is re-extracted, no longer emits the node, and no
    // unchanged source keeps it, so the carry-forward must NOT resurrect it.
    writeFixtureFile(
      fixture,
      '.claude/skills/notion-publish/SKILL.md',
      ['---', 'name: notion-publish', 'description: Mirror pages to Notion.', '---', 'Body.'].join(
        '\n',
      ),
    );
    const scoped = await scopedScan(fixture, prior, ['.claude/skills/notion-publish/SKILL.md']);

    ok(
      !scoped.nodes.find((n) => n.path === 'mcp://notion'),
      'the mcp node is dropped once its source no longer declares the tool',
    );
  });

  it('carries a virtual mcp node forward through a cached FULL walk (serve-boot mode)', async () => {
    const fixture = freshFixture('mcp-full-cache');
    writeFixtureFile(
      fixture,
      '.claude/skills/notion-publish/SKILL.md',
      [
        '---',
        'name: notion-publish',
        'description: Mirror pages to Notion.',
        'tools: [mcp__notion__notion-create-pages]',
        '---',
        'Body.',
      ].join('\n'),
    );
    const prior = await fullScan(fixture);
    ok(prior.nodes.find((n) => n.path === 'mcp://notion'), 'prior has the virtual mcp node');

    // Re-scan with the cache on and the prior snapshot but NO scoped-change
    // set: the cached FULL walk a `sm serve` boot runs. Nothing changed, so
    // the skill is a cache hit and `core/mcp-tools` never re-runs, yet the
    // node must survive (regression: it used to vanish on the second scan).
    const cached = await cachedFullScan(fixture, prior);
    ok(
      cached.nodes.find((n) => n.path === 'mcp://notion'),
      'the virtual mcp node survives a cached full walk',
    );
    ok(
      cached.links.some(
        (l) =>
          l.source === '.claude/skills/notion-publish/SKILL.md' && l.target === 'mcp://notion',
      ),
      'the skill -> mcp://notion reference still resolves after the cached full walk',
    );
  });
});
