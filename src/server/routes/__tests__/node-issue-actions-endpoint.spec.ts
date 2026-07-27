/**
 * Per-issue mutation routes integration tests
 * (`POST /api/nodes/:pathB64/issues/dismiss` / `.../issues/undismiss`;
 * `spec/cli-contract.md` §Serve route table).
 *
 * Boots a real `createServer()` against a primed project and exercises:
 *
 *   - dismiss without consent -> 412 `confirm-required`
 *     (`details.key = 'allowEditSmFiles'`), nothing written; with
 *     `confirm: true` -> 204, the `issueSuppressions` entry lands in
 *     the `.sm` VERBATIM (short analyzer id, note included), the mirror
 *     refreshes, the covered `scan_issues` rows are DELETED
 *     (emission-time semantics) and one `issues.dismiss` operations-log
 *     line appends; `always: true` persists the grant.
 *   - repeat dismiss is idempotent: 204 and no duplicate entry (both
 *     spellings, short and qualified, count as the same entry).
 *   - undismiss (exact identity) -> 204, entry removed, rows NOT
 *     resurrected (nothing to reveal, the documented asymmetry);
 *     no-match -> 409 `issue-suppression-not-found` AND the stale
 *     mirror self-heals first.
 *   - unknown node / malformed body -> 404 / 400.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  issueSuppressionsFromAnnotations,
  type IIssueSuppressionEntry,
} from '../../../kernel/util/issue-suppressions.js';
import { encodeNodePath } from '../../path-codec.js';
import {
  bootAndUse,
  seedIssues,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  withProjectDb,
  type IProbProject,
} from './helpers/prob-fixture.js';

interface IErrorBody {
  ok: boolean;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Short analyzer id, exactly as the issue row stores it. */
const ANALYZER = 'reference-broken';
const VALUE = '@missing-agent';

let tmpRoot: string;
let counter = 0;
let project: IProbProject;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-issue-actions-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// Fresh project per test: these routes mutate sidecars, config, and rows.
beforeEach(async () => {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  project = await setupProbProject(root, [SKILL_NODE], { installSkill: false });
  await seedIssues(project, [{ analyzerId: ANALYZER, target: VALUE }]);
});

function url(path: string): (handle: Parameters<typeof serverUrl>[0]) => string {
  return (handle) => serverUrl(handle, `/api/nodes/${encodeNodePath(SKILL_NODE.path)}${path}`);
}

async function post(
  handle: Parameters<typeof serverUrl>[0],
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(url(path)(handle), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The fixture project's sidecar path for the skill node. */
function sidecarAbs(): string {
  return join(project.root, `${SKILL_NODE.path.replace(/\.md$/, '')}.sm`);
}

/** Issue-suppression entries in the write-through mirror. */
async function mirrorIssueSuppressions(): Promise<IIssueSuppressionEntry[]> {
  return withProjectDb(project, async (adapter) => {
    const bundle = await adapter.scans.findNode(SKILL_NODE.path);
    return issueSuppressionsFromAnnotations(bundle?.node.sidecar?.annotations);
  });
}

async function issueRowCount(): Promise<number> {
  return withProjectDb(project, async (adapter) => (await adapter.issues.listAll()).length);
}

describe('POST /api/nodes/:pathB64/issues/dismiss', () => {
  it('412 confirm-required without consent; confirm:true dismisses (entry + row delete + ops line)', async () => {
    await bootAndUse(project, async (handle) => {
      const refused = await post(handle, '/issues/dismiss', { analyzer: ANALYZER, value: VALUE });
      assert.equal(refused.status, 412);
      const body = (await refused.json()) as IErrorBody;
      assert.equal(body.error.code, 'confirm-required');
      assert.equal(body.error.details?.['key'], 'allowEditSmFiles');
      assert.equal(existsSync(sidecarAbs()), false, 'nothing written on refusal');
      assert.equal(await issueRowCount(), 1, 'row survives the refusal');

      const ok = await post(handle, '/issues/dismiss', {
        analyzer: ANALYZER,
        value: VALUE,
        note: 'intentional prose',
        confirm: true,
      });
      assert.equal(ok.status, 204);
    });

    // Sidecar entry (verbatim short id + note) + write-through mirror.
    const sidecar = readFileSync(sidecarAbs(), 'utf8');
    assert.match(sidecar, /reference-broken/);
    assert.match(sidecar, /intentional prose/);
    assert.deepEqual(await mirrorIssueSuppressions(), [
      { analyzer: ANALYZER, value: VALUE, note: 'intentional prose' },
    ]);
    // Emission-time semantics: the covered row is DELETED.
    assert.equal(await issueRowCount(), 0, 'covered scan_issues row deleted');
    // One operations-log line, with the deleted count in hand.
    const ops = readFileSync(join(project.root, '.skill-map', 'operations.log'), 'utf8');
    assert.match(ops, /"op":"issues\.dismiss"/);
    assert.match(ops, /rows=1/);
  });

  it('repeat dismiss is idempotent: 204 and no duplicate entry (qualified spelling included)', async () => {
    await bootAndUse(project, async (handle) => {
      const first = await post(handle, '/issues/dismiss', {
        analyzer: ANALYZER,
        value: VALUE,
        confirm: true,
      });
      assert.equal(first.status, 204);
      const again = await post(handle, '/issues/dismiss', {
        analyzer: ANALYZER,
        value: VALUE,
        confirm: true,
      });
      assert.equal(again.status, 204);
      // The QUALIFIED spelling of the same analyzer is the SAME entry.
      const qualified = await post(handle, '/issues/dismiss', {
        analyzer: `core/${ANALYZER}`,
        value: VALUE,
        confirm: true,
      });
      assert.equal(qualified.status, 204);
    });
    assert.equal((await mirrorIssueSuppressions()).length, 1, 'single entry after repeats');
  });

  it('always:true persists the standing grant', async () => {
    await bootAndUse(project, async (handle) => {
      const ok = await post(handle, '/issues/dismiss', {
        analyzer: ANALYZER,
        value: VALUE,
        confirm: true,
        always: true,
      });
      assert.equal(ok.status, 204);
      // The grant persisted: a SECOND sidecar write sails through bare.
      const second = await post(handle, '/issues/dismiss', {
        analyzer: ANALYZER,
        value: 'other-token',
      });
      assert.equal(second.status, 204);
    });
    const local = readFileSync(join(project.root, '.skill-map/settings.local.json'), 'utf8');
    assert.match(local, /"allowEditSmFiles"\s*:\s*true/);
  });

  it('404 on an unknown node; 400 on a missing analyzer / value', async () => {
    await bootAndUse(project, async (handle) => {
      const unknown = await fetch(
        serverUrl(handle, `/api/nodes/${encodeNodePath('nope/ghost.md')}/issues/dismiss`),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ analyzer: ANALYZER, value: VALUE, confirm: true }),
        },
      );
      assert.equal(unknown.status, 404);

      const noAnalyzer = await post(handle, '/issues/dismiss', { value: VALUE });
      assert.equal(noAnalyzer.status, 400);
      const noValue = await post(handle, '/issues/dismiss', { analyzer: ANALYZER });
      assert.equal(noValue.status, 400);
    });
  });
});

describe('POST /api/nodes/:pathB64/issues/undismiss', () => {
  it('204 removes the entry (rows stay deleted); repeat -> 409 issue-suppression-not-found', async () => {
    await bootAndUse(project, async (handle) => {
      await post(handle, '/issues/dismiss', { analyzer: ANALYZER, value: VALUE, confirm: true });
      assert.equal((await mirrorIssueSuppressions()).length, 1);

      const ok = await post(handle, '/issues/undismiss', {
        analyzer: ANALYZER,
        value: VALUE,
        confirm: true,
      });
      assert.equal(ok.status, 204);
      assert.equal((await mirrorIssueSuppressions()).length, 0, 'mirror refreshed');
      // The documented asymmetry: nothing to reveal until the next scan.
      assert.equal(await issueRowCount(), 0, 'deleted rows are NOT resurrected');

      const again = await post(handle, '/issues/undismiss', {
        analyzer: ANALYZER,
        value: VALUE,
        confirm: true,
      });
      assert.equal(again.status, 409);
      assert.equal(((await again.json()) as IErrorBody).error.code, 'issue-suppression-not-found');
    });
    const ops = readFileSync(join(project.root, '.skill-map', 'operations.log'), 'utf8');
    assert.match(ops, /"op":"issues\.undismiss"/);
  });

  it('no-match 409 self-heals a stale mirror claim first', async () => {
    await bootAndUse(project, async (handle) => {
      // Seed a STALE mirror claim no live `.sm` backs.
      await withProjectDb(project, async (adapter) => {
        await adapter.scans.refreshAnnotations(SKILL_NODE.path, {
          issueSuppressions: [{ analyzer: ANALYZER, value: 'ghost' }],
        });
      });
      const miss = await post(handle, '/issues/undismiss', {
        analyzer: ANALYZER,
        value: 'ghost',
        confirm: true,
      });
      assert.equal(miss.status, 409);
      assert.equal(((await miss.json()) as IErrorBody).error.code, 'issue-suppression-not-found');
      assert.equal((await mirrorIssueSuppressions()).length, 0, 'stale mirror self-healed');
    });
  });

  it('404 on an unknown node', async () => {
    await bootAndUse(project, async (handle) => {
      const unknown = await fetch(
        serverUrl(handle, `/api/nodes/${encodeNodePath('nope/ghost.md')}/issues/undismiss`),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ analyzer: ANALYZER, value: VALUE, confirm: true }),
        },
      );
      assert.equal(unknown.status, 404);
    });
  });
});
