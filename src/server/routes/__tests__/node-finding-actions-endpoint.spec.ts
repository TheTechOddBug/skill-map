/**
 * Per-finding mutation routes integration tests
 * (`POST /api/nodes/:pathB64/findings/:id/dismiss` / `.../resolve` /
 * `.../findings/undismiss`; `spec/cli-contract.md` §Serve route table).
 *
 * Boots a real `createServer()` against a primed project and exercises:
 *
 *   - dismiss without consent -> 412 `confirm-required`
 *     (`details.key = 'allowEditSmFiles'`), nothing written; with
 *     `confirm: true` -> 204, the suppression lands in the `.sm` (note
 *     included), the mirror refreshes, the rows are KEPT and the findings
 *     GET hides the class as dismissed; `always: true` persists the grant.
 *   - kernel safety-lane findings refuse with 409 `finding-not-dismissible`.
 *   - resolve -> 204 + row flips to fixed/human; repeat -> 409
 *     `finding-already-fixed`; unknown / other-node id -> 404.
 *   - undismiss (exact identity) -> 204, entry removed, rows visible again;
 *     no-match -> 404 AND the stale mirror self-heals first.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { encodeNodePath } from '../../path-codec.js';
import {
  bootAndUse,
  FINDER_ID,
  seedFindings,
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

let tmpRoot: string;
let counter = 0;
let project: IProbProject;
/** Ids of the seeded rows, keyed by type (fresh per test). */
let ids: Map<string, number>;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-finding-actions-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// Fresh project per test: these routes mutate sidecars, config, and rows.
beforeEach(async () => {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  project = await setupProbProject(root, [SKILL_NODE], { installSkill: false });
  await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
    { type: 'redundancy' },
    { type: 'contradiction' },
  ]);
  await withProjectDb(project, async (adapter) => {
    // One kernel safety row alongside the finder rows.
    await adapter.db
      .insertInto('state_findings')
      .values({
        nodeId: SKILL_NODE.path,
        extensionId: 'kernel',
        extensionVersion: '0',
        origin: 'kernel',
        type: 'injection-detected',
        severity: 'warn',
        message: 'possible injection',
        detail: null,
        confidence: 0.9,
        model: null,
        resolution: null,
        resolutionActor: null,
        resolutionNote: null,
        resolutionBy: null,
        resolutionAt: null,
        bodyHashAtGeneration: (await adapter.scans.findNode(SKILL_NODE.path))!.node.bodyHash,
        generatedAt: Date.now(),
        jobId: null,
      })
      .execute();
    ids = new Map(
      (await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true })).map((f) => [
        f.type,
        f.id,
      ]),
    );
  });
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

async function mirrorSuppressions(): Promise<unknown> {
  return withProjectDb(project, async (adapter) =>
    (await adapter.findings.suppressionsByPath([SKILL_NODE.path])).get(SKILL_NODE.path),
  );
}

describe('POST /api/nodes/:pathB64/findings/:id/dismiss', () => {
  it('412 confirm-required without consent; confirm:true dismisses (rows kept, mirror fresh)', async () => {
    await bootAndUse(project, async (handle) => {
      const refused = await post(handle, `/findings/${ids.get('redundancy')}/dismiss`, {});
      assert.equal(refused.status, 412);
      const body = (await refused.json()) as IErrorBody;
      assert.equal(body.error.code, 'confirm-required');
      assert.equal(body.error.details?.['key'], 'allowEditSmFiles');
      assert.equal(existsSync(sidecarAbs()), false, 'nothing written on refusal');

      // The consent dialog's one-shot retry. Dismiss is a DIRECT action:
      // the body carries consent flags only (no note field; a `note` in
      // the body would 400 on `additionalProperties: false`).
      const ok = await post(handle, `/findings/${ids.get('redundancy')}/dismiss`, {
        confirm: true,
      });
      assert.equal(ok.status, 204);
    });

    // Sidecar entry + write-through mirror.
    assert.match(readFileSync(sidecarAbs(), 'utf8'), /redundancy/);
    assert.deepEqual(await mirrorSuppressions(), [
      { extension: FINDER_ID, type: 'redundancy' },
    ]);
    // Read-time lens: the rows are KEPT.
    await withProjectDb(project, async (adapter) => {
      const rows = await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true });
      assert.ok(rows.some((f) => f.type === 'redundancy'), 'row persists');
    });
  });

  it('the findings GET hides the dismissed class and counts it', async () => {
    await bootAndUse(project, async (handle) => {
      await post(handle, `/findings/${ids.get('redundancy')}/dismiss`, { confirm: true });
      const res = await fetch(url('/findings')(handle));
      const env = (await res.json()) as {
        items: Array<{ type: string }>;
        counts: { dismissedExcluded: number };
      };
      assert.ok(!env.items.some((i) => i.type === 'redundancy'), 'hidden from the tray');
      assert.equal(env.counts.dismissedExcluded, 1);
    });
  });

  it('always:true persists the standing grant', async () => {
    await bootAndUse(project, async (handle) => {
      const ok = await post(handle, `/findings/${ids.get('redundancy')}/dismiss`, {
        confirm: true,
        always: true,
      });
      assert.equal(ok.status, 204);
      // The grant persisted: a SECOND sidecar write sails through bare.
      const second = await post(handle, `/findings/${ids.get('contradiction')}/dismiss`, {});
      assert.equal(second.status, 204);
    });
    const local = readFileSync(join(project.root, '.skill-map/settings.local.json'), 'utf8');
    assert.match(local, /"allowEditSmFiles"\s*:\s*true/);
  });

  it('409 finding-not-dismissible for a kernel safety row; 404 for unknown ids', async () => {
    await bootAndUse(project, async (handle) => {
      const kernel = await post(handle, `/findings/${ids.get('injection-detected')}/dismiss`, {
        confirm: true,
      });
      assert.equal(kernel.status, 409);
      assert.equal(((await kernel.json()) as IErrorBody).error.code, 'finding-not-dismissible');

      const unknown = await post(handle, '/findings/99999/dismiss', { confirm: true });
      assert.equal(unknown.status, 404);
      const bad = await post(handle, '/findings/abc/dismiss', { confirm: true });
      assert.equal(bad.status, 404);
    });
  });
});

describe('POST /api/nodes/:pathB64/findings/:id/resolve', () => {
  it('204 flips to fixed/human with the note; repeat 409; unknown 404', async () => {
    await bootAndUse(project, async (handle) => {
      const ok = await post(handle, `/findings/${ids.get('redundancy')}/resolve`, {
        note: 'handled by me',
      });
      assert.equal(ok.status, 204);

      const again = await post(handle, `/findings/${ids.get('redundancy')}/resolve`, {});
      assert.equal(again.status, 409);
      assert.equal(((await again.json()) as IErrorBody).error.code, 'finding-already-fixed');

      const unknown = await post(handle, '/findings/99999/resolve', {});
      assert.equal(unknown.status, 404);
    });
    await withProjectDb(project, async (adapter) => {
      const row = (await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true })).find(
        (f) => f.type === 'redundancy',
      );
      assert.equal(row?.resolution, 'fixed');
      assert.equal(row?.resolutionActor, 'human');
      assert.equal(row?.resolutionNote, 'handled by me');
      assert.equal(row?.resolutionBy, null);
    });
  });
});

describe('POST /api/nodes/:pathB64/findings/undismiss', () => {
  it('204 removes the exact entry; the class shows again; no-match 404 self-heals the mirror', async () => {
    await bootAndUse(project, async (handle) => {
      await post(handle, `/findings/${ids.get('redundancy')}/dismiss`, { confirm: true });
      assert.notEqual(await mirrorSuppressions(), undefined);

      const ok = await post(handle, '/findings/undismiss', {
        extension: FINDER_ID,
        type: 'redundancy',
        confirm: true,
      });
      assert.equal(ok.status, 204);
      assert.equal(await mirrorSuppressions(), undefined, 'mirror refreshed');

      const tray = await fetch(url('/findings')(handle));
      const env = (await tray.json()) as { items: Array<{ type: string }> };
      assert.ok(env.items.some((i) => i.type === 'redundancy'), 'instant reappearance');

      // No-match: seed a STALE mirror claim (no sidecar entry backs it),
      // then undismiss -> 404, but the mirror is healed first.
      await withProjectDb(project, async (adapter) => {
        await adapter.scans.refreshAnnotations(SKILL_NODE.path, {
          suppressions: [{ extension: FINDER_ID, type: 'ghost' }],
        });
      });
      const miss = await post(handle, '/findings/undismiss', {
        extension: FINDER_ID,
        type: 'ghost',
        confirm: true,
      });
      assert.equal(miss.status, 404);
      assert.equal(await mirrorSuppressions(), undefined, 'stale mirror self-healed');
    });
  });

  it('400 when body.extension is missing', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await post(handle, '/findings/undismiss', { type: 'redundancy' });
      assert.equal(res.status, 400);
    });
  });
});

describe('DELETE /api/nodes/:pathB64/findings/:id', () => {
  async function del(
    handle: Parameters<typeof serverUrl>[0],
    id: number | string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(url(`/findings/${id}`)(handle), {
      method: 'DELETE',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  }

  it('204 hard-deletes the row (kernel rows included); last dismissed row lifts its suppression', async () => {
    await bootAndUse(project, async (handle) => {
      // Dismiss first so the deleted row is the revealed-bucket case the
      // X serves. Deleting the class's LAST row must ALSO remove the
      // suppression entry (an orphan dismissal would hide the class when
      // a later finder run re-finds it, user call 2026-07-20).
      await post(handle, `/findings/${ids.get('redundancy')}/dismiss`, { confirm: true });

      // Without consent the lift is gated: 412 and NOTHING mutates
      // (sidecar first, row second by design).
      const refused = await del(handle, ids.get('redundancy')!);
      assert.equal(refused.status, 412);
      assert.equal(((await refused.json()) as IErrorBody).error.code, 'confirm-required');

      const ok = await del(handle, ids.get('redundancy')!, { confirm: true });
      assert.equal(ok.status, 204);

      // All origins deletable (same rationale as `sm findings clear`);
      // no suppression on the kernel row, so no consent needed.
      const kernel = await del(handle, ids.get('injection-detected')!);
      assert.equal(kernel.status, 204);

      const unknown = await del(handle, 99999);
      assert.equal(unknown.status, 404);
    });
    await withProjectDb(project, async (adapter) => {
      const rows = await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true });
      assert.ok(!rows.some((f) => f.type === 'redundancy'), 'row hard-deleted');
      assert.ok(!rows.some((f) => f.type === 'injection-detected'), 'kernel row hard-deleted');
      assert.ok(rows.some((f) => f.type === 'contradiction'), 'other class survives');
    });
    // The orphan suppression entry was lifted with its last row.
    assert.doesNotMatch(readFileSync(sidecarAbs(), 'utf8'), /redundancy/);
    assert.equal(await mirrorSuppressions(), undefined, 'mirror refreshed');
  });

  it('a SIBLING row of the same dismissed class keeps the suppression entry', async () => {
    // Second row of the same (extension, type) class on the node.
    await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
      { type: 'redundancy' },
      { type: 'redundancy' },
    ]);
    await bootAndUse(project, async (handle) => {
      const rows = await withProjectDb(project, (adapter) =>
        adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true }),
      );
      const pair = rows.filter((f) => f.type === 'redundancy');
      assert.equal(pair.length, 2, 'precondition: two rows of the class');
      await post(handle, `/findings/${pair[0]!.id}/dismiss`, { confirm: true });

      // No consent flags needed: the sibling keeps the entry, so the
      // delete touches no sidecar.
      const ok = await del(handle, pair[0]!.id);
      assert.equal(ok.status, 204);
    });
    assert.match(
      readFileSync(sidecarAbs(), 'utf8'),
      /redundancy/,
      'suppression survives while a sibling row exists',
    );
  });
});
