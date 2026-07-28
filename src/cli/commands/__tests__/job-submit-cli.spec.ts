/**
 * End-to-end tests for `sm jobs submit / list / show` against a real
 * project (a scanned DB + a trusted project-local plugin shipping one
 * probabilistic action).
 *
 * Coverage:
 *   - submit -n success -> exit 0, queued job + content row persisted.
 *   - submit a deterministic (built-in) action -> exit 2.
 *   - submit --ttl 0 -> exit 2.
 *   - action not found -> exit 5; node not found -> exit 5.
 *   - duplicate resubmit -> exit 3 (existing id reported).
 *   - drift refusal: an edit-after-scan refuses with exit 2 + a re-scan
 *     advisory; a "re-scan" (body hash refreshed in the DB) proceeds.
 *   - unreadable refusal: a file deleted after the scan refuses with exit
 *     2 (clean advisory, no stack); in --all the refusal is per-node and
 *     the fan-out continues.
 *   - submit --all -> exit 0, one job per matching non-virtual node only.
 *   - list filters; show detail + exit 5 on a missing id; list/show
 *     --json OMIT the nonce (spec §Atomic claim · Nonce exposure).
 */

import { grantTrust } from '../../../kernel/config/plugin-trust-store.js';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { strictEqual, ok, match, doesNotMatch } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { JobSubmitCommand, JobListCommand, JobShowCommand, JobPreviewCommand } from '../job-queue.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { loadCanonicalPreamble } from '../../../kernel/jobs/index.js';
import { sha256 } from '../../../kernel/orchestrator/node-build.js';
import { agentSkillFile, installAgentSkill, uninstallAgentSkill } from '../../../core/agent-skill/engine.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/prob-summarizer', import.meta.url));
const PLUGIN_ID = 'prob-summarizer';
const ACTION_ID = 'prob-summarizer/skill-echo';

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

/** The on-disk body the fixture writes for `path` (after the fence). */
function bodyFor(path: string): string {
  return `Body of ${path}\n`;
}

async function insertNode(
  adapter: SqliteStorageAdapter,
  opts: { path: string; kind: string; provider: string; virtual?: boolean },
): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: opts.path,
      kind: opts.kind,
      provider: opts.provider,
      title: null,
      description: null,
      stability: null,
      version: null,
      sidecarStatus: null,
      annotationsJson: null,
      sidecarRootJson: null,
      frontmatterJson: '{}',
      // The REAL hash of the written body: the submit-time drift
      // verification recomputes it from disk and refuses on a mismatch.
      // Virtual nodes have no backing file; any value works (they are
      // excluded from submit either way).
      bodyHash: opts.virtual ? 'b'.repeat(64) : sha256(bodyFor(opts.path)),
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
      virtual: opts.virtual ? 1 : 0,
      derivedFromJson: null,
    })
    .execute();
}

interface IProject {
  root: string;
  dbPath: string;
}

/**
 * Build a temp project: copy the fixture plugin under `.skill-map/plugins`,
 * init the default project DB, insert the given nodes, trust the plugin,
 * and write a real body file for every non-virtual node so the render can
 * read it off disk.
 */
async function setupProject(
  nodes: { path: string; kind: string; provider: string; virtual?: boolean }[],
): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
  // Processing-agent gate (spec/job-lifecycle.md §Submit): submits refuse
  // unless the processing skill is installed; materialise the canonical copy.
  installAgentSkill(root, '.claude/skills');
  cpSync(FIXTURE, join(root, '.skill-map', 'plugins', PLUGIN_ID), { recursive: true });

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const node of nodes) {
      await insertNode(adapter, node);
      if (!node.virtual) {
        const abs = join(root, node.path);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, `---\ntitle: t\n---\n${bodyFor(node.path)}`);
      }
    }
    grantTrust(root, PLUGIN_ID);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

interface ISubmitOverrides {
  action: string;
  node?: string;
  all?: boolean;
  force?: boolean;
  ttl?: string;
  priority?: string;
  json?: boolean;
}

function buildSubmit(overrides: ISubmitOverrides): JobSubmitCommand {
  const cmd = new JobSubmitCommand();
  cmd.extension = overrides.action;
  cmd.node = overrides.node;
  cmd.all = overrides.all ?? false;
  cmd.force = overrides.force ?? false;
  cmd.ttl = overrides.ttl;
  cmd.priority = overrides.priority;
  cmd.json = overrides.json ?? false;
  cmd.db = undefined;
  return cmd;
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

async function countJobs(dbPath: string): Promise<number> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    const jobs = await adapter.jobs.list({});
    return jobs.length;
  } finally {
    await adapter.close();
  }
}

const SKILL = { path: '.claude/skills/foo/SKILL.md', kind: 'skill', provider: 'claude' };

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm jobs submit -n', () => {
  it('enqueues a probabilistic action -> exit 0, job + content persisted', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      const c = await run(cmd, cap);
      match(cap.stdout(), /^d-\d{8}-\d{6}-[0-9a-f]{4}\n$/);
      return c;
    });
    strictEqual(code, 0);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs.length, 1);
      const job = jobs[0];
      ok(job);
      strictEqual(job.status, 'queued');
      strictEqual(job.extensionId, ACTION_ID);
      strictEqual(job.nodeId, SKILL.path);
      const content = await adapter.db
        .selectFrom('state_job_contents')
        .selectAll()
        .where('contentHash', '=', job.contentHash)
        .executeTakeFirst();
      ok(content, 'content row persisted');
      ok(content.content.startsWith('You are operating inside skill-map'));
      ok(content.content.includes(`<user-content id="${SKILL.path}">`));
    } finally {
      await adapter.close();
    }
  });

  it('refuses a deterministic (built-in) action with exit 2', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: 'core/node-set-tags', node: SKILL.path });
      const c = await run(cmd, cap);
      match(cap.stderr(), /only probabilistic extensions are queued/);
      return c;
    });
    strictEqual(code, 2);
    strictEqual(await countJobs(proj.dbPath), 0);
  });

  it('defaults to NO TTL (Decision #139: jobs never expire absent an operator source)', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () =>
      run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), captureContext()),
    );
    strictEqual(code, 0);
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs[0]!.ttlSeconds, null, 'ttl_seconds stays NULL');
    } finally {
      await adapter.close();
    }
  });

  it('--ttl 45 arms the expiry; --json / list envelopes carry the number', async () => {
    const proj = await setupProject([SKILL]);
    const parsed = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(
        buildSubmit({ action: ACTION_ID, node: SKILL.path, ttl: '45', json: true }),
        cap,
      );
      strictEqual(code, 0);
      return JSON.parse(cap.stdout()) as { ttlSeconds: number | null };
    });
    strictEqual(parsed.ttlSeconds, 45);
  });

  it('--ttl 0 explicitly disarms (exit 0, ttlSeconds null on the envelope)', async () => {
    const proj = await setupProject([SKILL]);
    const parsed = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(
        buildSubmit({ action: ACTION_ID, node: SKILL.path, ttl: '0', json: true }),
        cap,
      );
      strictEqual(code, 0);
      return JSON.parse(cap.stdout()) as { ttlSeconds: number | null };
    });
    strictEqual(parsed.ttlSeconds, null);
  });

  it('rejects a negative --ttl with exit 2', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildSubmit({ action: ACTION_ID, node: SKILL.path, ttl: '-5' }), cap);
      match(cap.stderr(), /invalid --ttl/);
      return c;
    });
    strictEqual(code, 2);
    strictEqual(await countJobs(proj.dbPath), 0);
  });

  it('exits 5 when the action is not found', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: 'no/such-action', node: SKILL.path });
      const c = await run(cmd, cap);
      match(cap.stderr(), /not found/);
      return c;
    });
    strictEqual(code, 5);
  });

  it('exits 5 when the node is not in the scan', async () => {
    const proj = await setupProject([SKILL]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: '.claude/skills/missing/SKILL.md' });
      return run(cmd, cap);
    });
    strictEqual(code, 5);
  });

  it('refuses an active duplicate with exit 3 and prints the existing id', async () => {
    const proj = await setupProject([SKILL]);
    const first = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      return { code: await run(cmd, cap), id: cap.stdout().trim() };
    });
    strictEqual(first.code, 0);

    const second = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      const c = await run(cmd, cap);
      ok(cap.stderr().includes(first.id), 'reports the existing job id');
      return c;
    });
    strictEqual(second, 3);
    strictEqual(await countJobs(proj.dbPath), 1, 'no second job created');
  });

  it('does NOT supersede: two different-hash jobs for the same non-fixer (ext, node) coexist', async () => {
    // Supersede is fixer-only (spec §Findings injection for fixers · Supersede).
    // A non-fixer probabilistic action (no `precondition.analyzerIds`) keeps the
    // plain duplicate detection: two submits whose bodies (hence content
    // hashes) differ are legitimately distinct jobs and both stay queued.
    const proj = await setupProject([SKILL]);
    const firstId = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), cap);
      return cap.stdout().trim();
    });

    // Edit the body + restamp the scanned hash (simulate a re-scan) so the next
    // render produces a DIFFERENT content hash for the same (ext, node).
    appendFileSync(join(proj.root, SKILL.path), 'second revision\n');
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .updateTable('scan_nodes')
        .set({ bodyHash: sha256(`${bodyFor(SKILL.path)}second revision\n`) })
        .where('path', '=', SKILL.path)
        .execute();
    } finally {
      await adapter.close();
    }

    const secondId = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), cap);
      strictEqual(c, 0, cap.stderr());
      doesNotMatch(cap.stderr(), /superseded/, 'a non-fixer submit never supersedes');
      return cap.stdout().trim();
    });
    ok(secondId && secondId !== firstId, 'a distinct second job id');

    const adapter2 = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter2.init();
    try {
      const jobs = await adapter2.jobs.list({});
      strictEqual(jobs.length, 2, 'both jobs coexist');
      strictEqual(jobs.filter((j) => j.status === 'queued').length, 2, 'neither was cancelled');
    } finally {
      await adapter2.close();
    }
  });

  it('refuses with exit 2 when the node changed on disk since the scan (drift)', async () => {
    const proj = await setupProject([SKILL]);
    // Edit AFTER the (simulated) scan: the recomputed body hash diverges.
    appendFileSync(join(proj.root, SKILL.path), 'edited after scan\n');

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), cap);
      match(cap.stderr(), /changed on disk since the last scan/);
      match(cap.stderr(), /run sm scan/);
      return c;
    });
    strictEqual(code, 2);
    strictEqual(await countJobs(proj.dbPath), 0, 'no job enqueued for drifted content');
  });

  it('proceeds after a re-scan refreshes the stored body hash', async () => {
    const proj = await setupProject([SKILL]);
    const abs = join(proj.root, SKILL.path);
    appendFileSync(abs, 'edited after scan\n');
    // Simulate the re-scan: stamp the CURRENT on-disk body hash on the row.
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.db
        .updateTable('scan_nodes')
        .set({ bodyHash: sha256(`${bodyFor(SKILL.path)}edited after scan\n`) })
        .where('path', '=', SKILL.path)
        .execute();
    } finally {
      await adapter.close();
    }

    const code = await withCwd(proj.root, async () =>
      run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), captureContext()),
    );
    strictEqual(code, 0, 'submit proceeds once the scan matches the disk again');
    strictEqual(await countJobs(proj.dbPath), 1);
  });

  it('refuses with a clean exit 2 (no stack trace) when the node file was deleted', async () => {
    const proj = await setupProject([SKILL]);
    rmSync(join(proj.root, SKILL.path));

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const c = await run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), cap);
      match(cap.stderr(), /cannot be read from disk/);
      doesNotMatch(cap.stderr(), /at .*\.ts:\d+/, 'no raw stack trace leaks');
      doesNotMatch(cap.stderr(), /ENOENT/, 'no raw errno leaks');
      return c;
    });
    strictEqual(code, 2);
    strictEqual(await countJobs(proj.dbPath), 0);
  });
});

describe('sm jobs submit --all', () => {
  it('continues past a drifted / deleted node (per-node refusal, non-fatal)', async () => {
    const SECOND = { path: '.claude/skills/bar/SKILL.md', kind: 'skill', provider: 'claude' };
    const proj = await setupProject([SKILL, SECOND]);
    // One target vanishes after the scan; the other stays intact.
    rmSync(join(proj.root, SECOND.path));

    const outcome = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, all: true, json: true });
      const c = await run(cmd, cap);
      return { code: c, parsed: JSON.parse(cap.stdout()) };
    });
    strictEqual(outcome.code, 0, 'the fan-out is not aborted by one bad node');
    strictEqual(outcome.parsed.counts.submitted, 1);
    strictEqual(outcome.parsed.counts.refused, 1);
    strictEqual(outcome.parsed.submitted[0].nodeId, SKILL.path);
    strictEqual(outcome.parsed.refused[0].nodeId, SECOND.path);
    strictEqual(outcome.parsed.refused[0].reason, 'unreadable');
    strictEqual(await countJobs(proj.dbPath), 1, 'the intact node still enqueued');
  });

  it('fans out to matching non-virtual nodes only', async () => {
    const proj = await setupProject([
      SKILL,
      { path: '.claude/agents/bar.md', kind: 'agent', provider: 'claude' },
      { path: '.claude/skills/virt/SKILL.md', kind: 'skill', provider: 'claude', virtual: true },
    ]);
    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, all: true });
      return run(cmd, cap);
    });
    strictEqual(code, 0);

    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const jobs = await adapter.jobs.list({});
      strictEqual(jobs.length, 1, 'only the non-virtual claude/skill node matched');
      const job = jobs[0];
      ok(job);
      strictEqual(job.nodeId, SKILL.path);
    } finally {
      await adapter.close();
    }
  });
});

describe('sm jobs list / show', () => {
  it('lists jobs (JSON) and shows detail; missing id exits 5', async () => {
    const proj = await setupProject([SKILL]);
    const submitted = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = buildSubmit({ action: ACTION_ID, node: SKILL.path });
      await run(cmd, cap);
      return cap.stdout().trim();
    });

    // list --json
    const listCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobListCommand();
      cmd.json = true;
      cmd.status = undefined;
      cmd.extension = undefined;
      cmd.node = undefined;
      cmd.db = undefined;
      const c = await run(cmd, cap);
      const parsed = JSON.parse(cap.stdout());
      strictEqual(parsed.length, 1);
      strictEqual(parsed[0].id, submitted);
      // Security (spec §Atomic claim · Nonce exposure): the record
      // credential never rides the read surfaces.
      ok(!('nonce' in parsed[0]), 'list --json omits the nonce');
      return c;
    });
    strictEqual(listCode, 0);

    // list filter that matches nothing
    await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobListCommand();
      cmd.json = true;
      cmd.status = 'running';
      cmd.extension = undefined;
      cmd.node = undefined;
      cmd.db = undefined;
      await run(cmd, cap);
      strictEqual(JSON.parse(cap.stdout()).length, 0);
    });

    // show <id> --json
    const showCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobShowCommand();
      cmd.id = submitted;
      cmd.json = true;
      cmd.db = undefined;
      const c = await run(cmd, cap);
      const job = JSON.parse(cap.stdout());
      strictEqual(job.id, submitted);
      strictEqual(job.status, 'queued');
      strictEqual(job.ttlSeconds, null, 'TTL-less job emits ttlSeconds: null');
      // Security (spec §Atomic claim · Nonce exposure).
      ok(!('nonce' in job), 'show --json omits the nonce');
      return c;
    });
    strictEqual(showCode, 0);

    // show <id> human detail: the ttl line renders the none marker.
    await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobShowCommand();
      cmd.id = submitted;
      cmd.json = false;
      cmd.db = undefined;
      strictEqual(await run(cmd, cap), 0);
      match(cap.stdout(), /ttl\s+\(none\)/, 'TTL-less job renders (none)');
    });

    // show missing -> exit 5
    const missingCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobShowCommand();
      cmd.id = 'd-20990101-000000-ffff';
      cmd.json = false;
      cmd.db = undefined;
      return run(cmd, cap);
    });
    strictEqual(missingCode, 5);
  });
});

describe('sm jobs preview', () => {
  it('prints the rendered content (preamble verbatim + user-content block); missing id exits 5', async () => {
    const proj = await setupProject([SKILL]);
    const id = await withCwd(proj.root, async () => {
      const cap = captureContext();
      await run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), cap);
      return cap.stdout().trim();
    });

    const previewCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobPreviewCommand();
      cmd.id = id;
      cmd.last = false;
      cmd.json = false;
      cmd.db = undefined;
      const c = await run(cmd, cap);
      const out = cap.stdout();
      // The canonical preamble appears byte-for-byte: this is exactly what
      // the `preamble-bitwise-match` conformance case asserts.
      ok(out.includes(loadCanonicalPreamble()), 'preamble present verbatim');
      ok(out.includes(`<user-content id="${SKILL.path}">`), 'user-content block present');
      return c;
    });
    strictEqual(previewCode, 0);

    const missingCode = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobPreviewCommand();
      cmd.id = 'd-20990101-000000-ffff';
      cmd.last = false;
      cmd.json = false;
      cmd.db = undefined;
      return run(cmd, cap);
    });
    strictEqual(missingCode, 5);
  });

  it('--last previews the most recently submitted job', async () => {
    const NEWER = { path: '.claude/skills/newer/SKILL.md', kind: 'skill', provider: 'claude' };
    const proj = await setupProject([SKILL, NEWER]);
    await withCwd(proj.root, async () => {
      await run(buildSubmit({ action: ACTION_ID, node: SKILL.path }), captureContext());
      // `--last` resolves by newest createdAt (ms); force distinct stamps.
      await new Promise((r) => setTimeout(r, 5));
      await run(buildSubmit({ action: ACTION_ID, node: NEWER.path }), captureContext());
    });

    const code = await withCwd(proj.root, async () => {
      const cap = captureContext();
      const cmd = new JobPreviewCommand();
      cmd.id = undefined;
      cmd.last = true;
      cmd.json = false;
      cmd.db = undefined;
      const c = await run(cmd, cap);
      const out = cap.stdout();
      ok(out.includes(loadCanonicalPreamble()), 'preamble present verbatim');
      ok(out.includes(`<user-content id="${NEWER.path}">`), 'previews the newest job');
      ok(!out.includes(`<user-content id="${SKILL.path}">`), 'does not preview the older job');
      return c;
    });
    strictEqual(code, 0);
  });

  it('--last guards: conflict with <job.id> and missing target exit 2; empty queue exits 5', async () => {
    const proj = await setupProject([SKILL]);

    // <job.id> and --last together -> usage error.
    const conflictCode = await withCwd(proj.root, async () => {
      const cmd = new JobPreviewCommand();
      cmd.id = 'd-20990101-000000-ffff';
      cmd.last = true;
      cmd.json = false;
      cmd.db = undefined;
      return run(cmd, captureContext());
    });
    strictEqual(conflictCode, 2);

    // Neither <job.id> nor --last -> usage error.
    const neitherCode = await withCwd(proj.root, async () => {
      const cmd = new JobPreviewCommand();
      cmd.id = undefined;
      cmd.last = false;
      cmd.json = false;
      cmd.db = undefined;
      return run(cmd, captureContext());
    });
    strictEqual(neitherCode, 2);

    // --last with zero jobs -> not found.
    const emptyCode = await withCwd(proj.root, async () => {
      const cmd = new JobPreviewCommand();
      cmd.id = undefined;
      cmd.last = true;
      cmd.json = false;
      cmd.db = undefined;
      return run(cmd, captureContext());
    });
    strictEqual(emptyCode, 5);
  });
});

describe('sm jobs submit processing-agent gate (spec §Submit)', () => {
  async function submitCapture(
    proj: IProject,
    overrides: ISubmitOverrides,
  ): Promise<{ code: number; out: string; err: string }> {
    return withCwd(proj.root, async () => {
      const cap = captureContext();
      const code = await run(buildSubmit(overrides), cap);
      return { code, out: cap.stdout(), err: cap.stderr() };
    });
  }

  it('refuses with exit 2 and the mechanism advisory when no skill is installed', async () => {
    const proj = await setupProject([SKILL]);
    uninstallAgentSkill(proj.root, '.claude/skills');
    const { code, out, err } = await submitCapture(proj, { action: ACTION_ID, node: SKILL.path });
    strictEqual(code, 2);
    strictEqual(out, '', 'no job id on stdout');
    match(err, /no processing agent is set up/);
    match(err, /skill-map never runs jobs itself/);
    match(err, /sm agent install/);
    strictEqual(await countJobs(proj.dbPath), 0, 'nothing queued');
  });

  it('an installed-but-stale skill passes the gate with a refresh advisory', async () => {
    const proj = await setupProject([SKILL]);
    // Bytes that differ from the canonical template: an older CLI's copy.
    writeFileSync(agentSkillFile(proj.root, '.claude/skills'), 'old skill bytes\n');
    const { code, err } = await submitCapture(proj, { action: ACTION_ID, node: SKILL.path });
    strictEqual(code, 0, 'stale is an advisory, never a refusal');
    match(err, /sm-process-jobs skill is from an older CLI/);
    match(err, /sm agent install to refresh/);
    strictEqual(await countJobs(proj.dbPath), 1, 'job queued');
  });

  it('the stale advisory stays out of --json mode', async () => {
    const proj = await setupProject([SKILL]);
    writeFileSync(agentSkillFile(proj.root, '.claude/skills'), 'old skill bytes\n');
    const { code, out, err } = await submitCapture(proj, {
      action: ACTION_ID,
      node: SKILL.path,
      json: true,
    });
    strictEqual(code, 0);
    doesNotMatch(err, /older CLI/);
    ok(JSON.parse(out), 'stdout stays the plain Job envelope');
  });
});
