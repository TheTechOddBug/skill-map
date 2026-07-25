/**
 * End-to-end tests for the tagger current-tags injection
 * (`spec/job-lifecycle.md` §Current-tags injection for taggers) through the
 * real CLI verbs: `sm jobs submit` renders the node's CURRENT
 * `annotations.tags` into the stored job content (after any findings
 * section, before the report contract, outside `<user-content>`) and
 * `sm jobs preview` shows it.
 *
 * Why the feature exists: without it the model infers tags blind to what
 * the node already carries and proposes near-duplicates (`deploy` next to
 * an existing `deploy-pipeline`) that a human then reconciles by hand.
 *
 * Coverage:
 *   (a) TAGGER (`core/ai-tagger-action`) over a node WITH tags: the section
 *       lands, carries every tag, and sits before the `<user-content>` block.
 *   (b) the SAME tagger over a node with NO tags: no section at all.
 *   (c) a NON-tagger (`core/ai-summarizer-action`) over the tagged node:
 *       never carries the section.
 *   (d) editing the node's tags re-keys the content (`promptTemplateHash`
 *       folds the section in), so the duplicate pre-check stops matching.
 *
 * Runs against a real project DB (never `:memory:`, see
 * feedback_sqlite_in_memory_workaround).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobPreviewCommand } from '../job-queue.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';

const TAGGER_ID = 'core/ai-tagger-action';
const SUMMARIZER_ID = 'core/ai-summarizer-action';
const TAGGED = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };
const UNTAGGED = { path: 'notes/plain.md', kind: 'markdown', provider: 'markdown' };
const TAGS = ['deploy-pipeline', 'release-notes'];

const TAGS_HEADING = '## Current tags';

let tmpRoot: string;
let counter = 0;

interface ICaptured {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICaptured {
  const out: string[] = [];
  const err: string[] = [];
  const context = {
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function insertNode(
  adapter: SqliteStorageAdapter,
  node: { path: string; kind: string; provider: string },
  tags: readonly string[] | null,
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: node.path,
      kind: node.kind,
      provider: node.provider,
      title: null,
      description: null,
      stability: null,
      version: null,
      // Tags are human curation living in the `.sm` companion
      // (`spec/architecture.md` §Storage rule); the scan mirror
      // denormalises the parsed block into `annotations_json`, which is
      // exactly what the submit path rehydrates as
      // `node.sidecar.annotations`.
      sidecarPresent: tags === null ? 0 : 1,
      sidecarStatus: tags === null ? null : 'fresh',
      annotationsJson: tags === null ? null : JSON.stringify({ tags: [...tags] }),
      sidecarRootJson: null,
      frontmatterJson: '{}',
      // Real hash of the written body: submit verifies disk vs scan.
      bodyHash: sha256(`Body of ${node.path}\n`),
      frontmatterHash: 'f'.repeat(64),
      bytesFrontmatter: 0,
      bytesBody: 8,
      bytesTotal: 8,
      tokensFrontmatter: null,
      tokensBody: null,
      tokensTotal: null,
      externalRefsJson: null,
      scannedAt: Date.now(),
      modifiedAtMs: null,
      virtual: 0,
      derivedFromJson: null,
    })
    .execute();
}

interface IProject {
  root: string;
  dbPath: string;
}

async function setupProject(): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // core/ai-summarizer-action (the non-tagger control) ships experimental
  // (disabled by default); the tagger ships stable / enabled.
  writeFileSync(
    join(root, '.skill-map', 'settings.json'),
    JSON.stringify({
      plugins: { core: { extensions: { 'ai-summarizer-action': { enabled: true } } } },
    }),
  );
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed.
  installAgentSkill(root, '.claude/skills');

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter, TAGGED, TAGS);
    await insertNode(adapter, UNTAGGED, null);
    for (const node of [TAGGED, UNTAGGED]) {
      const abs = join(root, node.path);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, `---\ntitle: t\n---\nBody of ${node.path}\n`);
    }
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

/** Rewrite the tagged node's `annotations.tags` in the scan mirror. */
async function retag(proj: IProject, tags: readonly string[]): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.db
      .updateTable('scan_nodes')
      .set({ annotationsJson: JSON.stringify({ tags: [...tags] }) })
      .where('path', '=', TAGGED.path)
      .execute();
  } finally {
    await adapter.close();
  }
}

async function run(
  cmd: { context: BaseContext; execute(): Promise<number> },
  cap: ICaptured,
): Promise<number> {
  cmd.context = cap.context;
  return cmd.execute();
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const orig = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(orig);
  }
}

async function submit(
  proj: IProject,
  extension: string,
  node: string,
): Promise<{ code: number; err: string }> {
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const cmd = new JobSubmitCommand();
    cmd.extension = extension;
    cmd.node = node;
    cmd.all = false;
    cmd.force = false;
    cmd.ttl = undefined;
    cmd.priority = undefined;
    cmd.json = false;
    cmd.db = undefined;
    const code = await run(cmd, cap);
    return { code, err: cap.stderr() };
  });
}

/** `sm jobs preview --last` stdout (the rendered content). */
async function previewLast(proj: IProject): Promise<string> {
  return withCwd(proj.root, async () => {
    const cap = captureContext();
    const cmd = new JobPreviewCommand();
    cmd.id = undefined;
    cmd.last = true;
    cmd.json = false;
    cmd.db = undefined;
    strictEqual(await run(cmd, cap), 0, cap.stderr());
    return cap.stdout();
  });
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-current-tags-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('current-tags injection in the rendered job content', () => {
  it('(a) tagger over a TAGGED node carries the section before the user-content block', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, TAGGER_ID, TAGGED.path)).code, 0);

    const content = await previewLast(proj);
    const headingAt = content.indexOf(TAGS_HEADING);
    const contractAt = content.indexOf('## Report contract');
    const openAt = content.indexOf(`<user-content id="${TAGGED.path}">`);
    ok(headingAt > -1, 'kernel-authored heading present');
    ok(openAt > -1, 'user-content block present');
    ok(headingAt < contractAt, 'the section renders before the report contract');
    ok(contractAt < openAt, 'the whole prelude sits before the <user-content> block');
    for (const tag of TAGS) {
      ok(content.includes(`"${tag}"`), `existing tag ${tag} is stated to the model`);
    }
    // READ-ONLY framing, so the model reuses instead of re-proposing.
    ok(content.includes('READ-ONLY'), 'the caution rides with the tags');
    strictEqual(
      content.indexOf(TAGS_HEADING, content.indexOf('</user-content>')),
      -1,
      'nothing inside or after the delimiter',
    );
  });

  it('(b) tagger over an UNTAGGED node carries no section at all', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, TAGGER_ID, UNTAGGED.path)).code, 0);

    const content = await previewLast(proj);
    ok(content.includes('## Report contract'), 'the rest of the prelude still renders');
    strictEqual(content.includes(TAGS_HEADING), false, 'nothing to state, nothing injected');
  });

  it('(c) a NON-tagger over the tagged node never carries the section', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, SUMMARIZER_ID, TAGGED.path)).code, 0);

    const content = await previewLast(proj);
    ok(content.includes('## Report contract'), 'the summarizer still gets its contract');
    strictEqual(content.includes(TAGS_HEADING), false, 'the injection is tagger-only');
    strictEqual(
      content.includes(`"${TAGS[0]}"`),
      false,
      'no tag leaks into a non-tagger render',
    );
  });

  it('(d) changing the node tags re-keys the content (duplicate stops matching)', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, TAGGER_ID, TAGGED.path)).code, 0, 'first submit');
    strictEqual(
      (await submit(proj, TAGGER_ID, TAGGED.path)).code,
      3,
      'identical resubmit is an active duplicate',
    );

    // The section folds into `promptTemplateHash`, which folds into
    // `contentHash`: a node whose tags changed re-renders instead of
    // reusing a stale content row.
    await retag(proj, [...TAGS, 'ops']);
    strictEqual(
      (await submit(proj, TAGGER_ID, TAGGED.path)).code,
      0,
      'tag edit re-keys: no longer a duplicate',
    );
    ok((await previewLast(proj)).includes('"ops"'), 'the new tag reaches the render');
  });
});
