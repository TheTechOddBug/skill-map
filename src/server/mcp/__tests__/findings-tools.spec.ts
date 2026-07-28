/**
 * Unit tests for the write-gated MCP findings-lifecycle tool executors
 * (`server/mcp/findings-tools.ts`), exercised directly over a primed
 * project. The DB-only flips (resolve / row-dismiss / reopen) need no
 * consent; the sidecar writers (class-dismiss / undismiss) are checked
 * under a granted `allowEditSmFiles`, a refused consent, and the hard
 * `allowSidecarWriters: false` policy. Never `:memory:`.
 */

import { grantLocalKey } from '../../../kernel/config/local-key-grants.js';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

// eslint-disable-next-line import-x/extensions
import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { emptyPluginRuntime } from '../../../core/runtime/plugin-runtime.js';
import { WsBroadcaster } from '../../broadcaster.js';
import type { IMcpWriteContext } from '../context.js';
import {
  deleteFinding,
  dismissFinding,
  listFindings,
  reopenFinding,
  resolveFinding,
  undismissFinding,
} from '../findings-tools.js';
import {
  FINDER_ID,
  seedFindings,
  setupProbProject,
  SKILL_NODE,
  withProjectDb,
  type IProbProject,
} from '../../routes/__tests__/helpers/prob-fixture.js';

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-mcp-findings-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function makeProject(): Promise<IProbProject> {
  counter += 1;
  return setupProbProject(join(tmpRoot, `p-${counter}`), [SKILL_NODE], { installSkill: false });
}

function ctxFor(project: IProbProject): IMcpWriteContext {
  return {
    dbPath: project.dbPath,
    cwd: project.root,
    pluginRuntime: emptyPluginRuntime(),
    broadcaster: new WsBroadcaster(),
  };
}

/** Seed one finder finding and return its row id. */
async function seedOne(project: IProbProject, type = 'redundancy'): Promise<number> {
  await seedFindings(project, SKILL_NODE.path, FINDER_ID, [{ type }]);
  return withProjectDb(project, async (adapter) => {
    const list = await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true });
    return list[0]!.id;
  });
}

function grantConsent(project: IProbProject): void {
  writeFileSync(
    join(project.root, '.skill-map', 'settings.local.json'),
    JSON.stringify({ allowEditSmFiles: true }),
  );
  // The key alone is not consent (audit H1): it counts only with a grant
  // recorded in this checkout, so a clone cannot ship it.
  grantLocalKey(project.root, 'allowEditSmFiles', true);
}

function forbidSidecarWriters(project: IProbProject): void {
  writeFileSync(
    join(project.root, '.skill-map', 'settings.json'),
    JSON.stringify({ allowSidecarWriters: false }),
  );
}

function sidecarAbs(project: IProbProject): string {
  return join(project.root, `${SKILL_NODE.path.replace(/\.md$/, '')}.sm`);
}

describe('mcp list_findings (read)', () => {
  it('reads a node\'s findings, and all findings project-wide when node is omitted', async () => {
    const project = await makeProject();
    await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
      { type: 'redundancy' },
      { type: 'contradiction' },
    ]);
    const ctx = ctxFor(project);

    const scoped = await listFindings(ctx, { node: SKILL_NODE.path });
    assert.equal(scoped.findings.length, 2);
    assert.ok(scoped.findings.every((f) => f.nodeId === SKILL_NODE.path));

    const all = await listFindings(ctx, {});
    assert.equal(all.findings.length, 2);
  });

  it('filters by extension', async () => {
    const project = await makeProject();
    await seedFindings(project, SKILL_NODE.path, FINDER_ID, [{ type: 'redundancy' }]);
    const ctx = ctxFor(project);
    assert.equal((await listFindings(ctx, { extension: FINDER_ID })).findings.length, 1);
    assert.equal((await listFindings(ctx, { extension: 'core/other' })).findings.length, 0);
  });

  it('empty project (no DB rows) returns an empty list', async () => {
    const project = await makeProject();
    const { findings } = await listFindings(ctxFor(project), {});
    assert.deepEqual(findings, []);
  });
});

describe('mcp delete_finding', () => {
  it('hard-deletes a row by id, then reports not-found', async () => {
    const project = await makeProject();
    const id = await seedOne(project);
    const ctx = ctxFor(project);

    assert.deepEqual(await deleteFinding(ctx, { id }), { outcome: 'deleted' });
    // Gone from the DB.
    assert.equal((await listFindings(ctx, {})).findings.length, 0);
    // Second delete: not-found.
    assert.deepEqual(await deleteFinding(ctx, { id }), { outcome: 'not-found' });
  });

  it('an unknown id is not-found', async () => {
    const project = await makeProject();
    assert.deepEqual(await deleteFinding(ctxFor(project), { id: 999999 }), { outcome: 'not-found' });
  });

  it('deleting the LAST row of a dismissed class needs consent for the orphan lift', async () => {
    const project = await makeProject();
    const id = await seedOne(project, 'redundancy');
    grantConsent(project);
    // Class-dismiss writes the suppression to the sidecar.
    await dismissFinding(ctxFor(project), { id, class: true });
    // Deleting the last row of that class must lift the now-orphan
    // suppression; without a standing consent it refuses (McpError).
    rmSync(join(project.root, '.skill-map', 'settings.local.json'), { force: true });
    await assert.rejects(() => deleteFinding(ctxFor(project), { id }), McpError);
    // The row survived (the lift aborted before the delete).
    assert.equal((await listFindings(ctxFor(project), {})).findings.length, 1);
    // With consent, the delete + lift go through.
    grantConsent(project);
    assert.deepEqual(await deleteFinding(ctxFor(project), { id, confirm: true }), { outcome: 'deleted' });
    assert.equal((await listFindings(ctxFor(project), {})).findings.length, 0);
  });

  it('a plain (undismissed) row deletes with no consent (no orphan lift)', async () => {
    const project = await makeProject();
    const id = await seedOne(project);
    assert.deepEqual(await deleteFinding(ctxFor(project), { id }), { outcome: 'deleted' });
  });
});

describe('mcp resolve_finding (DB-only)', () => {
  it('resolves, then reports already-fixed, then not-found', async () => {
    const project = await makeProject();
    const id = await seedOne(project);
    assert.deepEqual(await resolveFinding(ctxFor(project), { id }), { outcome: 'resolved' });
    assert.deepEqual(await resolveFinding(ctxFor(project), { id }), { outcome: 'already-fixed' });
    assert.deepEqual(await resolveFinding(ctxFor(project), { id: 999999 }), { outcome: 'not-found' });
  });
});

describe('mcp dismiss_finding (row) + reopen_finding', () => {
  it('row-dismisses, refuses a repeat, then reopens', async () => {
    const project = await makeProject();
    const id = await seedOne(project);
    assert.deepEqual(await dismissFinding(ctxFor(project), { id }), { outcome: 'dismissed' });
    assert.deepEqual(await dismissFinding(ctxFor(project), { id }), { outcome: 'already-dismissed' });
    assert.deepEqual(await reopenFinding(ctxFor(project), { id }), { outcome: 'reopened' });
    assert.deepEqual(await reopenFinding(ctxFor(project), { id }), { outcome: 'already-open' });
  });
});

describe('mcp dismiss_finding (class, sidecar) consent', () => {
  it('refuses without consent, carrying the allowEditSmFiles hint', async () => {
    const project = await makeProject();
    const id = await seedOne(project);
    await assert.rejects(
      () => dismissFinding(ctxFor(project), { id, class: true }),
      (err: unknown) =>
        err instanceof McpError && /allowEditSmFiles/.test(err.message),
    );
    assert.equal(existsSync(sidecarAbs(project)), false, 'nothing written on refusal');
  });

  it('suppresses under a standing allowEditSmFiles grant', async () => {
    const project = await makeProject();
    grantConsent(project);
    const id = await seedOne(project);
    assert.deepEqual(await dismissFinding(ctxFor(project), { id, class: true }), { outcome: 'suppressed' });
    assert.match(readFileSync(sidecarAbs(project), 'utf8'), /redundancy/);
  });

  it('suppresses with a one-shot confirm', async () => {
    const project = await makeProject();
    const id = await seedOne(project);
    assert.deepEqual(
      await dismissFinding(ctxFor(project), { id, class: true, confirm: true }),
      { outcome: 'suppressed' },
    );
  });

  it('hard-blocks under allowSidecarWriters: false even with confirm', async () => {
    const project = await makeProject();
    forbidSidecarWriters(project);
    const id = await seedOne(project);
    await assert.rejects(
      () => dismissFinding(ctxFor(project), { id, class: true, confirm: true }),
      (err: unknown) => err instanceof McpError && /allowSidecarWriters/.test(err.message),
    );
  });
});

describe('mcp undismiss_finding (sidecar) consent', () => {
  it('removes the matching suppression under a standing grant', async () => {
    const project = await makeProject();
    grantConsent(project);
    const id = await seedOne(project);
    await dismissFinding(ctxFor(project), { id, class: true });
    assert.match(readFileSync(sidecarAbs(project), 'utf8'), /redundancy/);

    const result = await undismissFinding(ctxFor(project), {
      node: SKILL_NODE.path,
      extension: FINDER_ID,
      type: 'redundancy',
    });
    assert.deepEqual(result, { outcome: 'unsuppressed' });
    assert.doesNotMatch(readFileSync(sidecarAbs(project), 'utf8'), /redundancy/);
  });

  it('reports no-match when the class was never suppressed', async () => {
    const project = await makeProject();
    await seedOne(project);
    const result = await undismissFinding(ctxFor(project), {
      node: SKILL_NODE.path,
      extension: FINDER_ID,
      type: 'redundancy',
    });
    assert.deepEqual(result, { outcome: 'no-match' });
  });
});
