/**
 * CLI tests for `sm findings dismiss <id>` (`cli/commands/findings.ts`),
 * the durable-suppression half of Decision #144
 * (`spec/cli-contract.md` §sm findings dismiss). Rows are seeded straight
 * through the storage helpers; this spec pins the verb contract:
 *
 *   - writes a standing `annotations.suppressions` entry to the node's
 *     `.sm` sidecar (through the same consent gate as `sm bump`) AND
 *     deletes every `state_findings` row of that (extension, type) class.
 *   - idempotent: a repeat dismiss of the same (extension, type) class does
 *     NOT duplicate the sidecar entry; a different type from the same
 *     extension appends a distinct entry.
 *   - exit codes: 5 when the id is absent, 2 for a kernel safety-lane
 *     finding (not dismissible) or a non-positive-integer id.
 *   - `--json` emits the written suppression entry.
 *   - the consent gate is honored: a non-TTY caller without `--yes` refuses
 *     (exit 2) and touches nothing.
 *
 * Runs against a real project DB (never `:memory:`, see
 * feedback_sqlite_in_memory_workaround) and writes real `.sm` files under a
 * temp project root.
 */

import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { FindingsDismissCommand } from '../findings.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { replaceFindingsForNode } from '../../../kernel/adapters/sqlite/findings.js';
import { readSidecarFor, sidecarPathFor } from '../../../kernel/sidecar/index.js';
import { _resetSidecarStoreValidatorCacheForTests } from '../../../kernel/sidecar/store.js';
import { _resetSidecarValidatorCacheForTests } from '../../../kernel/sidecar/parse.js';
import type { IFindingInsertRow } from '../../../kernel/adapters/sqlite/findings.js';

const NODE = 'notes/guide.md';
const HASH = 'a'.repeat(64);
const FINDER_EXT = 'plug/finder-a';
const T0 = Date.parse('2026-01-01T00:00:00Z');

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
    // A non-TTY stdin so the consent wrapper resolves `isTTY` without a
    // throw; `--yes` is what actually grants the write on the happy path.
    stdin: { isTTY: false },
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function insertNode(adapter: SqliteStorageAdapter): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: NODE,
      kind: 'markdown',
      provider: 'markdown',
      title: null,
      description: null,
      stability: null,
      version: null,
      sidecarStatus: null,
      annotationsJson: null,
      sidecarRootJson: null,
      frontmatterJson: '{}',
      bodyHash: HASH,
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

const findingBase = {
  detail: null,
  extensionVersion: '1.0.0',
  jobId: null,
  model: null,
  bodyHashAtGeneration: HASH,
  generatedAt: T0,
} as const;

function extRow(type: string, severity: 'error' | 'warn' | 'info'): IFindingInsertRow {
  return {
    ...findingBase,
    origin: 'extension',
    type,
    severity,
    message: `${type} on the node`,
    confidence: 0.8,
  };
}

interface IProject {
  root: string;
  dbPath: string;
}

/** Seed a project DB with NODE and the given finder-lane findings. */
async function setupProject(
  rows: IFindingInsertRow[] = [extRow('contradiction', 'error'), extRow('redundancy', 'info')],
  extra?: (adapter: SqliteStorageAdapter) => Promise<void>,
): Promise<IProject> {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  // The node's parent dir must exist for the `.sm` sidecar to land next to
  // it (in a real project the scanned `.md` already anchors the directory).
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, NODE), 'Body of the guide\n');

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await insertNode(adapter);
    await replaceFindingsForNode(adapter.db, NODE, FINDER_EXT, rows);
    if (extra) await extra(adapter);
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
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

function buildDismiss(
  id: string,
  opts: { note?: string; json?: boolean; yes?: boolean } = {},
): FindingsDismissCommand {
  const cmd = new FindingsDismissCommand();
  cmd.id = id;
  cmd.note = opts.note;
  cmd.json = opts.json ?? false;
  cmd.yes = opts.yes ?? false;
  cmd.db = undefined;
  return cmd;
}

async function run(cmd: FindingsDismissCommand, cap: ICaptured): Promise<number> {
  cmd.context = cap.context;
  return cmd.execute();
}

/** Id of the seeded finding with `type` on NODE. */
async function findingId(proj: IProject, type: string): Promise<number> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const target = (await adapter.findings.list({ nodeId: NODE, includeStale: true })).find(
      (f) => f.type === type,
    );
    ok(target, `seeded ${type} finding exists`);
    return target.id;
  } finally {
    await adapter.close();
  }
}

async function findingTypes(proj: IProject): Promise<string[]> {
  const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
  await adapter.init();
  try {
    return (await adapter.findings.list({ nodeId: NODE, includeStale: true })).map((f) => f.type);
  } finally {
    await adapter.close();
  }
}

/** Read the written `.sm` sidecar's suppressions array (empty when absent). */
function readSuppressions(root: string): Array<Record<string, unknown>> {
  _resetSidecarValidatorCacheForTests();
  const result = readSidecarFor(join(root, NODE));
  const raw = result.parsed?.annotations?.['suppressions'];
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-findings-dismiss-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  _resetSidecarStoreValidatorCacheForTests();
  _resetSidecarValidatorCacheForTests();
});

describe('sm findings dismiss', () => {
  it('writes the suppression entry AND deletes the (extension, type) class', async () => {
    const proj = await setupProject();
    const id = await findingId(proj, 'contradiction');

    const code = await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: true }), captureContext()),
    );
    strictEqual(code, 0);

    // Durable sidecar suppression landed.
    const supp = readSuppressions(proj.root);
    deepStrictEqual(supp, [{ extension: FINDER_EXT, type: 'contradiction' }]);

    // The whole contradiction class is gone; the sibling redundancy stays.
    deepStrictEqual(await findingTypes(proj), ['redundancy']);
  });

  it('records the optional --note on the suppression entry', async () => {
    const proj = await setupProject();
    const id = await findingId(proj, 'contradiction');
    await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: true, note: 'Intentional; the two steps are alternatives.' }), captureContext()),
    );
    deepStrictEqual(readSuppressions(proj.root), [
      { extension: FINDER_EXT, type: 'contradiction', note: 'Intentional; the two steps are alternatives.' },
    ]);
  });

  it('--json emits the written suppression entry', async () => {
    const proj = await setupProject();
    const id = await findingId(proj, 'contradiction');
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: true, json: true }), cap),
    );
    strictEqual(code, 0);
    const body = JSON.parse(cap.stdout()) as {
      ok: boolean;
      kind: string;
      suppression: Record<string, unknown>;
      node: string;
      deleted: number;
    };
    strictEqual(body.ok, true);
    strictEqual(body.kind, 'suppression');
    deepStrictEqual(body.suppression, { extension: FINDER_EXT, type: 'contradiction' });
    strictEqual(body.node, NODE);
    strictEqual(body.deleted, 1);
  });

  it('exit 5 when the id does not exist (nothing written)', async () => {
    const proj = await setupProject();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss('99999', { yes: true }), captureContext()),
    );
    strictEqual(code, 5);
    strictEqual(existsSync(join(proj.root, sidecarPathFor(NODE))), false);
  });

  it('exit 2 for a kernel safety-lane finding (not dismissible)', async () => {
    // Seed a kernel safety row alongside the finder rows.
    const proj = await setupProject(
      [extRow('contradiction', 'error')],
      async (adapter) => {
        await replaceFindingsForNode(adapter.db, NODE, 'other/checker', [
          {
            ...findingBase,
            origin: 'kernel',
            type: 'injection-detected',
            severity: 'warn',
            message: 'possible injection',
            confidence: 0.8,
          },
        ]);
      },
    );
    const id = await findingId(proj, 'injection-detected');
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: true }), cap),
    );
    strictEqual(code, 2);
    ok(/cannot be dismissed/.test(cap.stderr()), cap.stderr());
    // Nothing written.
    strictEqual(existsSync(join(proj.root, sidecarPathFor(NODE))), false);
  });

  it('exit 2 for a non-positive-integer id', async () => {
    const proj = await setupProject();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss('abc', { yes: true }), captureContext()),
    );
    strictEqual(code, 2);
  });

  it('idempotent: a repeat dismiss of the same (extension, type) does not duplicate the entry', async () => {
    const proj = await setupProject([extRow('contradiction', 'error')]);
    const firstId = await findingId(proj, 'contradiction');
    await withCwd(proj.root, async () => run(buildDismiss(String(firstId), { yes: true }), captureContext()));
    deepStrictEqual(readSuppressions(proj.root), [{ extension: FINDER_EXT, type: 'contradiction' }]);

    // Re-seed the same class (a fresh finder occurrence) and dismiss again.
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      await replaceFindingsForNode(adapter.db, NODE, FINDER_EXT, [extRow('contradiction', 'error')]);
    } finally {
      await adapter.close();
    }
    const secondId = await findingId(proj, 'contradiction');
    await withCwd(proj.root, async () => run(buildDismiss(String(secondId), { yes: true }), captureContext()));

    // Still exactly one contradiction entry (no duplicate).
    deepStrictEqual(readSuppressions(proj.root), [{ extension: FINDER_EXT, type: 'contradiction' }]);
  });

  it('a different type from the same extension appends a distinct entry', async () => {
    const proj = await setupProject();
    const contradictionId = await findingId(proj, 'contradiction');
    await withCwd(proj.root, async () => run(buildDismiss(String(contradictionId), { yes: true }), captureContext()));
    const redundancyId = await findingId(proj, 'redundancy');
    await withCwd(proj.root, async () => run(buildDismiss(String(redundancyId), { yes: true }), captureContext()));

    deepStrictEqual(readSuppressions(proj.root), [
      { extension: FINDER_EXT, type: 'contradiction' },
      { extension: FINDER_EXT, type: 'redundancy' },
    ]);
  });

  it('consent gate honored: a non-TTY caller without --yes refuses (exit 2) and touches nothing', async () => {
    const proj = await setupProject();
    const id = await findingId(proj, 'contradiction');
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: false }), cap),
    );
    strictEqual(code, 2);
    ok(/consent required/.test(cap.stderr()), cap.stderr());
    // No sidecar written and the class rows are intact.
    strictEqual(existsSync(join(proj.root, sidecarPathFor(NODE))), false);
    deepStrictEqual((await findingTypes(proj)).sort(), ['contradiction', 'redundancy']);
  });
});
