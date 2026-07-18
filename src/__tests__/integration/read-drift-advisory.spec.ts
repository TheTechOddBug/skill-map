/**
 * Verb-level coverage for the read-side drift posture
 * (`spec/db-schema.md` §Schema drift): read surfaces ADVISE and proceed
 * on a schema-fingerprint mismatch, write surfaces refuse.
 *
 *   - `sm history` (a read verb threading `buildReadVersionCheck`)
 *     against a tampered-fingerprint DB WARNS on stderr and still exits
 *     0 with its data.
 *   - `sm jobs fail --all` (a mutating job verb on the default write-side
 *     open) against the same DB refuses with exit 2 and the
 *     `DbSchemaDriftError` advisory.
 *   - a BFF GET (`/api/issues`) against the drifted DB returns 200 with
 *     data (a one-shot warn goes to the server log), never a `db-drift`
 *     refusal envelope.
 *
 * Real on-disk SQLite files only (per
 * `feedback_sqlite_in_memory_workaround`).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { VERSION } from '../../cli/version.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { Node, ScanResult } from '../../kernel/types.js';
import { HistoryCommand } from '../../cli/commands/history.js';
import { FindingsCommand, FindingsPruneCommand } from '../../cli/commands/findings.js';
import { JobClaimCommand, JobFailCommand, JobSubmitCommand } from '../../cli/commands/job-queue.js';
import { RecordCommand } from '../../cli/commands/record.js';
import { PluginsTrustCommand } from '../../cli/commands/plugins/trust.js';
import { PluginsEnableCommand } from '../../cli/commands/plugins/toggle.js';
import {
  createServer,
  type IServerOptions,
} from '../../server/index.js';

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-read-drift-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function freshDbPath(label: string): string {
  counter += 1;
  return join(tmpRoot, `${label}-${counter}.db`);
}

function makeNode(path: string): Node {
  return {
    path,
    kind: 'note',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    frontmatter: {},
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function makeScanResult(): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: 1_700_000_000_000,
    roots: ['.'],
    providers: ['claude'],
    // Stamp the CURRENT version so the classifier lands on 'ok' and the
    // FINGERPRINT is the sole drift source, regardless of the checkout's
    // version (a hardcoded literal broke the first prerelease CI run,
    // 0.89.0-rc.0 vs '0.88.0' classified warn-older and won the one-shot).
    scannedBy: { name: 'skill-map', version: VERSION, specVersion: '1.0.0' },
    nodes: [makeNode('a.md')],
    links: [],
    issues: [],
    stats: {
      filesWalked: 1,
      filesSkipped: 0,
      nodesCount: 1,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

/**
 * Drop a live column so a query against the CURRENT schema genuinely
 * fails (the drift materialising). Paired with the fingerprint tamper
 * for the read-conversion cases; used alone for the healthy-DB negative
 * case (untampered fingerprint = no drift detected = raw error).
 */
function dropFindingsModelColumn(dbPath: string): void {
  const raw = new DatabaseSync(dbPath);
  try {
    raw.exec('ALTER TABLE state_findings DROP COLUMN model');
  } finally {
    raw.close();
  }
}

/**
 * Persist a scan stamped by an OLDER minor of the CLI (fingerprint left
 * CURRENT, so the VERSION axis is the sole drift source). Exercises the
 * write-gate's version leg.
 */
async function seedOlderMinorDb(dbPath: string): Promise<string> {
  const parsed = /^(\d+)\.(\d+)\.(\d+)/.exec(VERSION);
  const major = Number(parsed![1]);
  const minor = Number(parsed![2]);
  const olderVersion = `${major}.${Math.max(0, minor - 1)}.0`;
  const result = makeScanResult();
  result.scannedBy = { name: 'skill-map', version: olderVersion, specVersion: '1.0.0' };
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.scans.persist(result);
  } finally {
    await adapter.close();
  }
  return olderVersion;
}

/** Persist a scan (stamps version + fingerprint), then tamper the fingerprint. */
async function seedDriftedDb(dbPath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await adapter.scans.persist(makeScanResult());
  } finally {
    await adapter.close();
  }
  const raw = new DatabaseSync(dbPath);
  try {
    raw.exec("UPDATE scan_meta SET schema_fingerprint = 'stale-fingerprint'");
  } finally {
    raw.close();
  }
}

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

describe('read-side drift posture (verb level)', () => {
  it('sm history against a tampered-fingerprint DB warns and succeeds', async () => {
    const dbPath = freshDbPath('history-read');
    await seedDriftedDb(dbPath);

    const cmd = new HistoryCommand();
    cmd.db = dbPath;
    cmd.json = true;
    // Clipanion fields hold Option descriptors until a real CLI parse
    // assigns them; direct construction must null the optionals out.
    cmd.node = undefined;
    cmd.extension = undefined;
    cmd.status = undefined;
    cmd.since = undefined;
    cmd.until = undefined;
    cmd.limit = undefined;
    const cap = captureContext();
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 0, 'read verb proceeds on fingerprint drift');
    assert.deepEqual(JSON.parse(cap.stdout()), [], 'data still returned');
    assert.match(cap.stderr(), /schema change/, 'one-shot drift advisory on stderr');
  });

  it('a mutating job verb still refuses the drifted DB with exit 2', async () => {
    const dbPath = freshDbPath('fail-write');
    await seedDriftedDb(dbPath);

    const cmd = new JobFailCommand();
    cmd.db = dbPath;
    cmd.all = true;
    cmd.id = undefined;
    const cap = captureContext();
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 2, 'write verb refuses on fingerprint drift');
    assert.match(cap.stderr(), /sm scan/, 'advisory names the remediation (scan owns the rebuild)');
  });

  it('a BFF GET against the drifted DB returns data (advise-and-proceed)', async () => {
    const dbPath = freshDbPath('bff-get');
    await seedDriftedDb(dbPath);

    const options: IServerOptions = {
      port: 0,
      host: '127.0.0.1',
      dbPath,
      uiDist: null,
      noUi: false,
      noBuiltIns: true,
      noPlugins: true,
      open: false,
      devCors: false,
      noWatcher: true,
      mcpServer: false,
    };
    const handle = await createServer(options);
    try {
      const res = await fetch(`http://127.0.0.1:${handle.address.port}/api/issues`);
      assert.equal(res.status, 200, 'GET proceeds on fingerprint drift, no db-drift 500');
      const body = (await res.json()) as { items: unknown[] };
      assert.ok(Array.isArray(body.items), 'payload carries the data envelope');
    } finally {
      await handle.close();
    }
  });
});

// spec/cli-contract.md §Schema-drift rebuild, the read/write split for
// non-drift-owning verbs. Both behaviours below were observed live:
// `sm findings` printed the advisory then crashed `no such column`, and
// `sm jobs submit` reported `extension not found` because the plugin
// trust read degraded on the drifted DB.
describe('drift hygiene: reads convert failures, writes refuse early', () => {
  function buildFindings(dbPath: string): FindingsCommand {
    const cmd = new FindingsCommand();
    cmd.db = dbPath;
    cmd.node = undefined;
    cmd.extension = undefined;
    cmd.type = undefined;
    cmd.severity = undefined;
    cmd.since = undefined;
    cmd.threshold = undefined;
    cmd.stale = false;
    cmd.json = false;
    return cmd;
  }

  it('sm findings on a drifted DB with a missing column exits 2 with the advisory, never raw SQL', async () => {
    const dbPath = freshDbPath('findings-drift-read');
    await seedDriftedDb(dbPath);
    dropFindingsModelColumn(dbPath);

    const cap = captureContext();
    const cmd = buildFindings(dbPath);
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 2, 'read failure on a drifted DB is an operational error');
    assert.match(cap.stderr(), /drifted DB/, 'clean drift advisory rendered');
    assert.match(cap.stderr(), /sm scan/, 'names the remedy');
    assert.doesNotMatch(cap.stderr(), /no such column/, 'raw SQL never surfaces');
  });

  it('a healthy DB (no drift detected) still surfaces genuine SQL failures raw', async () => {
    const dbPath = freshDbPath('findings-healthy-sql-bug');
    // Persist WITHOUT tampering the fingerprint: the advisory reads
    // `ok`, so the conversion must not mask the genuine failure.
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      await adapter.scans.persist(makeScanResult());
    } finally {
      await adapter.close();
    }
    dropFindingsModelColumn(dbPath);

    const cap = captureContext();
    const cmd = buildFindings(dbPath);
    cmd.context = cap.context;
    await assert.rejects(
      () => cmd.execute(),
      /no such column/,
      'no drift detected: the raw error rethrows untouched',
    );
  });

  it('sm jobs submit refuses the drifted DB BEFORE resolution (no misleading not-found)', async () => {
    const dbPath = freshDbPath('submit-drift-write');
    await seedDriftedDb(dbPath);

    const cmd = new JobSubmitCommand();
    cmd.db = dbPath;
    cmd.extension = 'finder-that-would-not-resolve';
    cmd.node = 'a.md';
    cmd.all = false;
    cmd.force = false;
    cmd.ttl = undefined;
    cmd.priority = undefined;
    cmd.json = false;
    const cap = captureContext();
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 2, 'write verb refuses on drift');
    assert.match(cap.stderr(), /cannot be written safely/, 'the drift advisory names the cause');
    assert.doesNotMatch(cap.stderr(), /not found/, 'the misleading resolution symptom never fires');
  });

  it('sm record refuses the drifted DB before the nonce lookup', async () => {
    const dbPath = freshDbPath('record-drift-write');
    await seedDriftedDb(dbPath);

    const cmd = new RecordCommand();
    cmd.db = dbPath;
    cmd.id = 'd-20260101-000000-0001';
    cmd.nonce = 'n'.repeat(32);
    cmd.status = 'completed';
    cmd.report = 'report.json';
    cmd.error = undefined;
    cmd.tokensIn = undefined;
    cmd.tokensOut = undefined;
    cmd.durationMs = undefined;
    cmd.model = undefined;
    cmd.json = false;
    const cap = captureContext();
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 2);
    assert.match(cap.stderr(), /cannot be written safely/);
    assert.doesNotMatch(cap.stderr(), /job .* not found/, 'never reaches the job lookup');
  });

  it('sm findings prune refuses the drifted DB before counting', async () => {
    const dbPath = freshDbPath('findings-prune-drift');
    await seedDriftedDb(dbPath);

    const cmd = new FindingsPruneCommand();
    cmd.db = dbPath;
    cmd.dryRun = false;
    cmd.yes = true;
    cmd.json = false;
    const cap = captureContext();
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 2);
    assert.match(cap.stderr(), /cannot be written safely/);
  });

  /** The plugin verbs resolve the DB from cwd (no --db flag). */
  async function withProjectCwd<T>(fn: (dbPath: string) => Promise<T>): Promise<T> {
    counter += 1;
    const root = join(tmpRoot, `plugin-scope-${counter}`);
    mkdirSync(join(root, '.skill-map'), { recursive: true });
    const dbPath = join(root, '.skill-map', 'skill-map.db');
    const orig = process.cwd();
    process.chdir(root);
    try {
      return await fn(dbPath);
    } finally {
      process.chdir(orig);
    }
  }

  it('sm plugins trust refuses the drifted DB (a grant written there is lost on rebuild)', async () => {
    await withProjectCwd(async (dbPath) => {
      await seedDriftedDb(dbPath);

      const cmd = new PluginsTrustCommand();
      cmd.all = false;
      cmd.ids = ['some-plugin'];
      const cap = captureContext();
      cmd.context = cap.context;
      const code = await cmd.execute();

      assert.equal(code, 2, 'trust refuses on drift before discovery');
      assert.match(cap.stderr(), /cannot be written safely/);
      assert.doesNotMatch(cap.stderr(), /not found/, 'never reaches id resolution');
    });
  });

  it('sm plugins enable refuses the drifted DB (symmetric with disable)', async () => {
    await withProjectCwd(async (dbPath) => {
      await seedDriftedDb(dbPath);

      const cmd = new PluginsEnableCommand();
      cmd.all = false;
      cmd.yes = false;
      cmd.local = false;
      cmd.ids = ['core/link-counter'];
      const cap = captureContext();
      cmd.context = cap.context;
      const code = await cmd.execute();

      assert.equal(code, 2);
      assert.match(cap.stderr(), /cannot be written safely/);
    });
  });

  it('sm jobs claim refuses the drifted DB with exit 2, never the empty-queue exit 1', async () => {
    const dbPath = freshDbPath('claim-drift-write');
    await seedDriftedDb(dbPath);

    const cmd = new JobClaimCommand();
    cmd.db = dbPath;
    cmd.filter = undefined;
    cmd.json = false;
    cmd.wait = false;
    const cap = captureContext();
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 2, 'drift refusal, not the empty-queue exit 1');
    assert.match(cap.stderr(), /cannot be written safely/);
  });

  it('the VERSION axis alone (older-minor DB, current fingerprint) refuses writes too', async () => {
    const dbPath = freshDbPath('submit-version-drift');
    const olderVersion = await seedOlderMinorDb(dbPath);

    const cmd = new JobSubmitCommand();
    cmd.db = dbPath;
    cmd.extension = 'anything';
    cmd.node = 'a.md';
    cmd.all = false;
    cmd.force = false;
    cmd.ttl = undefined;
    cmd.priority = undefined;
    cmd.json = false;
    const cap = captureContext();
    cmd.context = cap.context;
    const code = await cmd.execute();

    assert.equal(code, 2, 'a minor difference is drift for writes (reads only warn)');
    assert.match(cap.stderr(), /cannot be written safely/);
    assert.ok(cap.stderr().includes(olderVersion), 'advisory names the writing version');
  });
});

