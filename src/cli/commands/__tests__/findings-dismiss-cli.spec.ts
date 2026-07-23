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

import {
  FindingsCommand,
  FindingsDismissCommand,
  FindingsReopenCommand,
  FindingsSuppressionsCommand,
  FindingsUndismissCommand,
} from '../findings.js';
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
  opts: { note?: string; json?: boolean; yes?: boolean; row?: boolean } = {},
): FindingsDismissCommand {
  const cmd = new FindingsDismissCommand();
  cmd.id = id;
  cmd.note = opts.note;
  cmd.json = opts.json ?? false;
  cmd.yes = opts.yes ?? false;
  // These tests exercise the historical CLASS suppression unless a case
  // opts into the 2026-07-22 row-grain default explicitly.
  cmd.classWide = opts.row === true ? false : true;
  cmd.db = undefined;
  return cmd;
}

async function run(
  cmd: { context: BaseContext; execute(): Promise<number> },
  cap: ICaptured,
): Promise<number> {
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
  it('writes the suppression entry, KEEPS the rows, refreshes the annotations mirror', async () => {
    const proj = await setupProject();
    const id = await findingId(proj, 'contradiction');

    const code = await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: true }), captureContext()),
    );
    strictEqual(code, 0);

    // Durable sidecar suppression landed.
    const supp = readSuppressions(proj.root);
    deepStrictEqual(supp, [{ extension: FINDER_EXT, type: 'contradiction' }]);

    // Read-time lens: NOTHING deleted, both rows persist in the table.
    deepStrictEqual((await findingTypes(proj)).sort(), ['contradiction', 'redundancy']);

    // Write-through: the denormalized mirror carries the suppression, so
    // the read surfaces (view + counters) see the dismissal without a scan.
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      const byPath = await adapter.findings.suppressionsByPath([NODE]);
      deepStrictEqual(byPath.get(NODE), [{ extension: FINDER_EXT, type: 'contradiction' }]);
      // And the card counters skip the dismissed class: only the sibling
      // counts... (both seeded rows are error/info: contradiction is error,
      // redundancy is info which never reaches a chip), so the node counts
      // ZERO chips after the dismissal.
      const counts = await adapter.findings.countUnresolvedByPath([NODE]);
      strictEqual(counts.get(NODE), undefined, 'dismissed error row lights no chip');
    } finally {
      await adapter.close();
    }
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

  it('--json emits the written suppression entry (no delete count, nothing is deleted)', async () => {
    const proj = await setupProject();
    const id = await findingId(proj, 'contradiction');
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: true, json: true }), cap),
    );
    strictEqual(code, 0);
    const body = JSON.parse(cap.stdout()) as Record<string, unknown>;
    strictEqual(body['ok'], true);
    strictEqual(body['kind'], 'suppression');
    deepStrictEqual(body['suppression'], { extension: FINDER_EXT, type: 'contradiction' });
    strictEqual(body['node'], NODE);
    strictEqual('deleted' in body, false, 'the lens deletes nothing');
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

  it('read-time lens round-trip: default view hides the class, --dismissed reveals it, undismiss restores it instantly', async () => {
    const proj = await setupProject();
    const id = await findingId(proj, 'contradiction');
    await withCwd(proj.root, async () =>
      run(buildDismiss(String(id), { yes: true }), captureContext()),
    );

    // Default view: the dismissed class hides, the sibling shows, and the
    // excluded breakdown reports it honestly.
    const after = await readFindingsJson(proj);
    deepStrictEqual(
      after.findings.map((f) => f['type'] as string),
      ['redundancy'],
      'dismissed class hidden from the default view',
    );
    strictEqual(after.dismissedExcluded, 1);

    // --dismissed reveals ONLY the suppressed bucket.
    const revealed = await readFindingsJson(proj, { dismissed: true });
    deepStrictEqual(
      revealed.findings.map((f) => f['type'] as string),
      ['contradiction'],
    );

    // Undismiss: rows were never deleted, so the class shows again
    // IMMEDIATELY, no finder re-run.
    strictEqual(
      await withCwd(proj.root, async () =>
        run(
          buildUndismiss({ extension: FINDER_EXT, type: 'contradiction', yes: true }),
          captureContext(),
        ),
      ),
      0,
    );
    const restored = await readFindingsJson(proj);
    deepStrictEqual(
      restored.findings.map((f) => f['type'] as string).sort(),
      ['contradiction', 'redundancy'],
      'instant reappearance',
    );
    strictEqual(restored.dismissedExcluded, 0);
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

function buildSuppressions(
  opts: { node?: string; json?: boolean } = {},
): FindingsSuppressionsCommand {
  const cmd = new FindingsSuppressionsCommand();
  cmd.node = opts.node;
  cmd.json = opts.json ?? false;
  cmd.db = undefined;
  return cmd;
}

function buildUndismiss(opts: {
  node?: string;
  extension: string;
  type?: string;
  yes?: boolean;
  json?: boolean;
}): FindingsUndismissCommand {
  const cmd = new FindingsUndismissCommand();
  cmd.node = opts.node ?? NODE;
  cmd.extension = opts.extension;
  cmd.type = opts.type;
  cmd.yes = opts.yes ?? false;
  cmd.json = opts.json ?? false;
  cmd.db = undefined;
  return cmd;
}

/** Run the `sm findings --json` read verb against the project. */
async function readFindingsJson(
  proj: IProject,
  flags: { dismissed?: boolean } = {},
): Promise<{ findings: Array<Record<string, unknown>>; dismissedExcluded: number }> {
  const cmd = new FindingsCommand();
  cmd.node = undefined;
  cmd.extension = undefined;
  cmd.type = undefined;
  cmd.severity = undefined;
  cmd.since = undefined;
  cmd.threshold = undefined;
  cmd.stale = false;
  cmd.fixed = false;
  cmd.dismissed = flags.dismissed ?? false;
  cmd.json = true;
  cmd.db = undefined;
  const cap = captureContext();
  strictEqual(await withCwd(proj.root, async () => run(cmd, cap)), 0);
  return JSON.parse(cap.stdout()) as {
    findings: Array<Record<string, unknown>>;
    dismissedExcluded: number;
  };
}

/** Dismiss the seeded finding of `type` (consented), leaving its suppression. */
async function dismissType(proj: IProject, type: string): Promise<void> {
  const id = await findingId(proj, type);
  const code = await withCwd(proj.root, async () =>
    run(buildDismiss(String(id), { yes: true }), captureContext()),
  );
  strictEqual(code, 0, `dismiss of ${type} succeeds`);
}

describe('sm findings suppressions', () => {
  it('lists the active entries (node, extension, type) after dismisses', async () => {
    const proj = await setupProject();
    await dismissType(proj, 'contradiction');
    await dismissType(proj, 'redundancy');

    const cap = captureContext();
    const code = await withCwd(proj.root, async () => run(buildSuppressions({ json: true }), cap));
    strictEqual(code, 0);
    const body = JSON.parse(cap.stdout()) as {
      ok: boolean;
      kind: string;
      suppressions: Array<Record<string, unknown>>;
    };
    strictEqual(body.ok, true);
    strictEqual(body.kind, 'suppressions');
    deepStrictEqual(body.suppressions, [
      { node: NODE, extension: FINDER_EXT, type: 'contradiction' },
      { node: NODE, extension: FINDER_EXT, type: 'redundancy' },
    ]);
  });

  it('human mode renders the rows and the undismiss tip', async () => {
    const proj = await setupProject();
    await dismissType(proj, 'contradiction');
    const cap = captureContext();
    strictEqual(await withCwd(proj.root, async () => run(buildSuppressions(), cap)), 0);
    ok(/1 active/.test(cap.stdout()), cap.stdout());
    ok(new RegExp(`${NODE}.*${FINDER_EXT}.*contradiction`).test(cap.stdout()), cap.stdout());
    ok(/undismiss/.test(cap.stdout()), 'points at the escape hatch');
  });

  it('-n narrows to the named node; a node without entries yields none', async () => {
    const proj = await setupProject();
    await dismissType(proj, 'contradiction');
    const hit = captureContext();
    strictEqual(
      await withCwd(proj.root, async () => run(buildSuppressions({ node: NODE, json: true }), hit)),
      0,
    );
    strictEqual(
      (JSON.parse(hit.stdout()) as { suppressions: unknown[] }).suppressions.length,
      1,
    );

    const miss = captureContext();
    strictEqual(
      await withCwd(proj.root, async () =>
        run(buildSuppressions({ node: 'other.md', json: true }), miss),
      ),
      0,
    );
    strictEqual(
      (JSON.parse(miss.stdout()) as { suppressions: unknown[] }).suppressions.length,
      0,
    );
  });

  it('friendly empty line when nothing is suppressed', async () => {
    const proj = await setupProject();
    const cap = captureContext();
    strictEqual(await withCwd(proj.root, async () => run(buildSuppressions(), cap)), 0);
    ok(/No active suppressions/.test(cap.stdout()), cap.stdout());
  });
});

describe('sm findings undismiss', () => {
  it('removes the matching typed entry, keeps the sibling, echoes the removal', async () => {
    const proj = await setupProject();
    await dismissType(proj, 'contradiction');
    await dismissType(proj, 'redundancy');

    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(
        buildUndismiss({ extension: FINDER_EXT, type: 'contradiction', yes: true, json: true }),
        cap,
      ),
    );
    strictEqual(code, 0);
    const body = JSON.parse(cap.stdout()) as {
      ok: boolean;
      kind: string;
      removed: Record<string, unknown>;
      node: string;
    };
    strictEqual(body.ok, true);
    strictEqual(body.kind, 'unsuppression');
    deepStrictEqual(body.removed, { extension: FINDER_EXT, type: 'contradiction' });
    strictEqual(body.node, NODE);

    // The sidecar keeps ONLY the sibling entry: the class is eligible again.
    deepStrictEqual(readSuppressions(proj.root), [{ extension: FINDER_EXT, type: 'redundancy' }]);
  });

  it('matches the extension by bare id too', async () => {
    const proj = await setupProject();
    await dismissType(proj, 'contradiction');
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ extension: 'finder-a', type: 'contradiction', yes: true }), captureContext()),
    );
    strictEqual(code, 0);
    deepStrictEqual(readSuppressions(proj.root), []);
  });

  it('exit 5 when no entry matches (wrong type, or omitting --type for a typed entry)', async () => {
    const proj = await setupProject();
    await dismissType(proj, 'contradiction');

    const wrongType = captureContext();
    strictEqual(
      await withCwd(proj.root, async () =>
        run(buildUndismiss({ extension: FINDER_EXT, type: 'redundancy', yes: true }), wrongType),
      ),
      5,
    );
    ok(/No suppression/.test(wrongType.stderr()), wrongType.stderr());

    // Omitting --type targets the type-less blanket entry ONLY; the typed
    // contradiction entry does not match.
    const blanket = captureContext();
    strictEqual(
      await withCwd(proj.root, async () =>
        run(buildUndismiss({ extension: FINDER_EXT, yes: true }), blanket),
      ),
      5,
    );
    deepStrictEqual(readSuppressions(proj.root), [
      { extension: FINDER_EXT, type: 'contradiction' },
    ]);
  });

  it('exit 5 when the node is not in the current scan', async () => {
    const proj = await setupProject();
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ node: 'ghost.md', extension: FINDER_EXT, yes: true }), cap),
    );
    strictEqual(code, 5);
    ok(/not in the current scan/.test(cap.stderr()), cap.stderr());
  });

  it('exit 2 when a bare --extension matches entries from two qualified ids', async () => {
    // Two finders sharing the bare name `finder-a` under different plugins,
    // both dismissed for the same type.
    const proj = await setupProject(
      [extRow('contradiction', 'error')],
      async (adapter) => {
        await replaceFindingsForNode(adapter.db, NODE, 'other/finder-a', [
          extRow('contradiction', 'error'),
        ]);
      },
    );
    // Dismiss each extension's occurrence by ITS OWN id (the type alone is
    // ambiguous here, both extensions carry a contradiction row).
    for (const extension of [FINDER_EXT, 'other/finder-a']) {
      const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
      await adapter.init();
      let id: number;
      try {
        const target = (await adapter.findings.list({ nodeId: NODE, includeStale: true })).find(
          (f) => f.extensionId === extension,
        );
        ok(target, `${extension} finding exists`);
        id = target.id;
      } finally {
        await adapter.close();
      }
      strictEqual(
        await withCwd(proj.root, async () =>
          run(buildDismiss(String(id), { yes: true }), captureContext()),
        ),
        0,
      );
    }

    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ extension: 'finder-a', type: 'contradiction', yes: true }), cap),
    );
    strictEqual(code, 2);
    ok(/matches 2 suppressions/.test(cap.stderr()), cap.stderr());
    // Both entries stand untouched.
    strictEqual(readSuppressions(proj.root).length, 2);
  });

  it('no-match self-heals a stale mirror: hand-deleted .sm stops hiding the rows', async () => {
    const proj = await setupProject();
    await dismissType(proj, 'contradiction');
    // The row is hidden by the mirror-backed lens.
    strictEqual((await readFindingsJson(proj)).dismissedExcluded, 1);

    // The operator deletes the sidecar OUTSIDE skill-map (observed live):
    // the file truth carries no suppression, the mirror still does.
    rmSync(join(proj.root, sidecarPathFor(NODE)));
    _resetSidecarValidatorCacheForTests();

    // Undismiss finds nothing in the live file -> exit 5, but it SELF-HEALS
    // the mirror first, so the view stops hiding the class.
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ extension: FINDER_EXT, type: 'contradiction', yes: true }), cap),
    );
    strictEqual(code, 5);
    ok(/No suppression/.test(cap.stderr()), cap.stderr());

    const after = await readFindingsJson(proj);
    strictEqual(after.dismissedExcluded, 0, 'mirror healed');
    deepStrictEqual(
      after.findings.map((f) => f['type'] as string).sort(),
      ['contradiction', 'redundancy'],
      'the rows show again',
    );
  });

  it('consent gate honored: a non-TTY caller without --yes refuses (exit 2), entry stays', async () => {
    // Hand-author the sidecar instead of dismissing first: a consented
    // dismiss persists the grant (`always: true` flips allowEditSmFiles),
    // which would let the undismiss through and void the gate under test.
    const proj = await setupProject();
    writeFileSync(
      join(proj.root, sidecarPathFor(NODE)),
      [
        'annotations:',
        '  suppressions:',
        `    - extension: ${FINDER_EXT}`,
        '      type: contradiction',
        'identity:',
        `  bodyHash: ${HASH}`,
        `  frontmatterHash: ${'f'.repeat(64)}`,
        `  path: ${NODE}`,
        '',
      ].join('\n'),
    );
    const cap = captureContext();
    const code = await withCwd(proj.root, async () =>
      run(buildUndismiss({ extension: FINDER_EXT, type: 'contradiction', yes: false }), cap),
    );
    strictEqual(code, 2);
    ok(/consent required/.test(cap.stderr()), cap.stderr());
    deepStrictEqual(readSuppressions(proj.root), [
      { extension: FINDER_EXT, type: 'contradiction' },
    ]);
  });
});

describe('sm findings dismiss (row grain, the 2026-07-22 default) + reopen', () => {
  async function findingIds(proj: IProject): Promise<number[]> {
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      return (await adapter.findings.list({ nodeId: NODE, includeStale: true }))
        .map((f) => f.id)
        .sort((x, y) => x - y);
    } finally {
      await adapter.close();
    }
  }

  async function resolutionOf(proj: IProject, id: number): Promise<string | null> {
    const adapter = new SqliteStorageAdapter({ databasePath: proj.dbPath, autoBackup: false });
    await adapter.init();
    try {
      return (await adapter.findings.get(id))?.resolution ?? null;
    } finally {
      await adapter.close();
    }
  }

  it('dismisses ONLY the targeted row, no sidecar; reopen restores it', async () => {
    const proj = await setupProject();
    const [a, b] = await findingIds(proj);

    await withCwd(proj.root, async () => {
      const cap = captureContext();
      strictEqual(await run(buildDismiss(String(a), { row: true }), cap), 0, cap.stderr());
    });
    strictEqual(await resolutionOf(proj, a!), 'dismissed');
    strictEqual(await resolutionOf(proj, b!), null, 'the sibling stays open');
    strictEqual(existsSync(join(proj.root, sidecarPathFor(NODE))), false, 'no sidecar written');

    await withCwd(proj.root, async () => {
      // Repeat refuses (exit 2); reopen restores; reopen again refuses.
      strictEqual(await run(buildDismiss(String(a), { row: true }), captureContext()), 2);
      const reopen = new FindingsReopenCommand();
      reopen.id = String(a);
      reopen.json = false;
      reopen.db = undefined;
      strictEqual(await run(reopen, captureContext()), 0);
    });
    strictEqual(await resolutionOf(proj, a!), null, 'reopened');
    await withCwd(proj.root, async () => {
      const again = new FindingsReopenCommand();
      again.id = String(a);
      again.json = false;
      again.db = undefined;
      strictEqual(await run(again, captureContext()), 2, 'already open refuses');
    });
  });
});
