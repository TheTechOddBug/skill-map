/**
 * Verb-level coverage for the read-side drift posture
 * (`spec/db-schema.md` §Schema drift): read surfaces ADVISE and proceed
 * on a schema-fingerprint mismatch, write surfaces refuse.
 *
 *   - `sm history` (a read verb threading `buildReadVersionCheck`)
 *     against a tampered-fingerprint DB WARNS on stderr and still exits
 *     0 with its data.
 *   - `sm job fail --all` (a mutating job verb on the default write-side
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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { VERSION } from '../../cli/version.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { Node, ScanResult } from '../../kernel/types.js';
import { HistoryCommand } from '../../cli/commands/history.js';
import { JobFailCommand } from '../../cli/commands/job-queue.js';
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
    cmd.action = undefined;
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
    assert.match(cap.stderr(), /sm db reset --hard/, 'advisory names the remediation');
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
