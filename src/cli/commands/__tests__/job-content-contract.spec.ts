/**
 * End-to-end tests for the report-contract render prelude
 * (`spec/job-lifecycle.md` §Submit step 9) through the real CLI verbs:
 * `sm jobs submit` renders the extension's report-schema chain into the
 * job content (after the template prose, before the `<user-content>`
 * block) and `sm jobs preview` shows the fenced blocks.
 *
 * Coverage:
 *   (a) on-disk probabilistic ANALYZER (prob-finder fixture): its raw
 *       `report.schema.json` bytes + the findings envelope +
 *       report-base, all verbatim, outside `<user-content>`.
 *   (b) built-in probabilistic ACTION (`core/ai-summarizer-action`): the
 *       codegen-inlined `reportSchema` serialized deterministically +
 *       `summaries/markdown.schema.json` + report-base.
 *   (c) a schema-byte edit re-keys the content: the duplicate pre-check
 *       stops matching (`promptTemplateHash` folds the contract in).
 */

import { grantTrust } from '../../../kernel/config/plugin-trust-store.js';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobPreviewCommand } from '../job-queue.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { loadSpecSchemaText } from '../../../kernel/jobs/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { builtIns } from '../../../plugins/built-ins.js';
import { installAgentSkill } from '../../../core/agent-skill/engine.js';

const FINDER_FIXTURE = fileURLToPath(new URL('./fixtures/prob-finder', import.meta.url));
const FINDER_PLUGIN_ID = 'prob-finder';
const FINDER_ID = 'prob-finder/quality-check';
const FINDER_SCHEMA_REL = join('analyzers', 'quality-check', 'report.schema.json');

const SKILL = { path: '.claude/skills/foo/SKILL.md', kind: 'skill', provider: 'claude' };
const NOTE = { path: 'notes/guide.md', kind: 'markdown', provider: 'markdown' };

const REPORT_BASE_BYTES = loadSpecSchemaText('schemas/report-base.schema.json');
const FINDINGS_ENVELOPE_BYTES = loadSpecSchemaText('schemas/findings/report.schema.json');
const SUMMARIES_MARKDOWN_BYTES = loadSpecSchemaText('schemas/summaries/markdown.schema.json');

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
      sidecarStatus: null,
      annotationsJson: null,
      sidecarRootJson: null,
      frontmatterJson: '{}',
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
  mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
  // core/ai-summarizer-action ships experimental (disabled by default);
  // case (b) submits it, so opt it back in for this project.
  writeFileSync(
    join(root, '.skill-map', 'settings.json'),
    JSON.stringify({ plugins: { core: { extensions: { 'ai-summarizer-action': { enabled: true } } } } }),
  );
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed; materialise the canonical copy.
  installAgentSkill(root, '.claude/skills');
  cpSync(FINDER_FIXTURE, join(root, '.skill-map', 'plugins', FINDER_PLUGIN_ID), {
    recursive: true,
  });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const node of [SKILL, NOTE]) {
      await insertNode(adapter, node);
      const abs = join(root, node.path);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, `---\ntitle: t\n---\nBody of ${node.path}\n`);
    }
    grantTrust(root, FINDER_PLUGIN_ID);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

async function run(cmd: { context: BaseContext; execute(): Promise<number> }, cap: ICaptured): Promise<number> {
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

async function submit(proj: IProject, extension: string, node: string): Promise<{ code: number; err: string }> {
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

/**
 * Assert the full schema chain renders outside the user-content block.
 * The anchor is the REAL block opening (`<user-content id="<path>">`),
 * not the bare tag name: the canonical preamble legitimately MENTIONS
 * `<user-content id="...">` in its delimiter-contract prose.
 */
function assertContractLayout(
  content: string,
  nodePath: string,
  schemaBytes: string,
  envelopeBytes: string,
): void {
  const headingAt = content.indexOf('## Report contract');
  const openAt = content.indexOf(`<user-content id="${nodePath}">`);
  ok(headingAt > -1, 'kernel-authored heading present');
  ok(openAt > -1, 'user-content block present');
  ok(content.includes(schemaBytes), 'extension schema verbatim');
  ok(content.includes(envelopeBytes), 'namespace envelope byte-copy');
  ok(content.includes(REPORT_BASE_BYTES), 'report-base byte-copy');
  ok(headingAt < openAt, 'contract sits BEFORE the <user-content> block');
  ok(
    content.indexOf(REPORT_BASE_BYTES) < openAt,
    'the whole chain sits outside (before) <user-content>',
  );
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-content-contract-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('report contract in the rendered job content', () => {
  it('(a) on-disk probabilistic analyzer: raw file bytes + findings envelope + base', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, FINDER_ID, SKILL.path)).code, 0);

    const content = await previewLast(proj);
    const schemaBytes = readFileSync(
      join(proj.root, '.skill-map', 'plugins', FINDER_PLUGIN_ID, FINDER_SCHEMA_REL),
      'utf8',
    );
    assertContractLayout(content, SKILL.path, schemaBytes, FINDINGS_ENVELOPE_BYTES);
  });

  it('(b) built-in probabilistic action: inlined reportSchema + summaries envelope + base', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, 'core/ai-summarizer-action', NOTE.path)).code, 0);

    const content = await previewLast(proj);
    const summarizer = builtIns().actions.find((a) => a.id === 'ai-summarizer-action');
    ok(summarizer?.reportSchema, 'built-in carries the codegen-inlined reportSchema');
    const schemaText = JSON.stringify(summarizer.reportSchema, null, 2);
    assertContractLayout(content, NOTE.path, schemaText, SUMMARIES_MARKDOWN_BYTES);
  });

  it('(c) a schema-byte edit re-keys the content hash (duplicate stops matching)', async () => {
    const proj = await setupProject();
    strictEqual((await submit(proj, FINDER_ID, SKILL.path)).code, 0, 'first submit');
    strictEqual(
      (await submit(proj, FINDER_ID, SKILL.path)).code,
      3,
      'identical resubmit is an active duplicate',
    );

    // One byte of the extension schema changes -> the report contract
    // changes -> promptTemplateHash changes -> contentHash changes, so
    // the duplicate pre-check no longer matches.
    const schemaPath = join(proj.root, '.skill-map', 'plugins', FINDER_PLUGIN_ID, FINDER_SCHEMA_REL);
    writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8') + '\n');
    strictEqual(
      (await submit(proj, FINDER_ID, SKILL.path)).code,
      0,
      'schema edit re-keys: no longer a duplicate',
    );
  });
});
