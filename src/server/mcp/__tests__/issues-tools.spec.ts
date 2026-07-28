/**
 * Unit tests for the write-gated MCP issue-suppression tool executors
 * (`server/mcp/issues-tools.ts`), exercised directly over a primed
 * project (mirror of `findings-tools.spec.ts`). The two mutating tools
 * ride the consent-gated sidecar channel (checked under a granted
 * `allowEditSmFiles`, a refused consent, and the hard
 * `allowSidecarWriters: false` policy); `list_issue_suppressions` is a
 * pure read over the annotations mirror. Never `:memory:`.
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
  dismissIssue,
  listIssueSuppressions,
  undismissIssue,
} from '../issues-tools.js';
import {
  seedIssues,
  setupProbProject,
  SKILL_NODE,
  withProjectDb,
  type IProbProject,
} from '../../routes/__tests__/helpers/prob-fixture.js';

/** Short analyzer id, exactly as the issue row stores it. */
const ANALYZER = 'reference-broken';
const VALUE = '@missing-agent';

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-mcp-issues-'));
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

async function issueRowCount(project: IProbProject): Promise<number> {
  return withProjectDb(project, async (adapter) => (await adapter.issues.listAll()).length);
}

describe('mcp dismiss_issue (sidecar + row delete) consent', () => {
  it('refuses without consent, carrying the allowEditSmFiles hint', async () => {
    const project = await makeProject();
    await seedIssues(project, [{ analyzerId: ANALYZER, target: VALUE }]);
    await assert.rejects(
      () => dismissIssue(ctxFor(project), { node: SKILL_NODE.path, analyzer: ANALYZER, value: VALUE }),
      (err: unknown) => err instanceof McpError && /allowEditSmFiles/.test(err.message),
    );
    assert.equal(existsSync(sidecarAbs(project)), false, 'nothing written on refusal');
    assert.equal(await issueRowCount(project), 1, 'row survives the refusal');
  });

  it('suppresses under a standing grant: entry + note in the sidecar, covered rows deleted', async () => {
    const project = await makeProject();
    grantConsent(project);
    await seedIssues(project, [
      { analyzerId: ANALYZER, target: VALUE },
      { analyzerId: ANALYZER, target: 'unrelated-token' },
    ]);
    const result = await dismissIssue(ctxFor(project), {
      node: SKILL_NODE.path,
      analyzer: ANALYZER,
      value: VALUE,
      note: 'intentional prose',
    });
    assert.deepEqual(result, { outcome: 'suppressed', deletedIssues: 1 });
    const sidecar = readFileSync(sidecarAbs(project), 'utf8');
    assert.match(sidecar, /reference-broken/);
    assert.match(sidecar, /intentional prose/);
    assert.equal(await issueRowCount(project), 1, 'only the covered row deleted');
  });

  it('a repeat dismiss is already-suppressed (no duplicate entry, both spellings)', async () => {
    const project = await makeProject();
    grantConsent(project);
    await seedIssues(project, [{ analyzerId: ANALYZER, target: VALUE }]);
    const ctx = ctxFor(project);
    await dismissIssue(ctx, { node: SKILL_NODE.path, analyzer: ANALYZER, value: VALUE });
    // Qualified spelling of the same analyzer: SAME entry.
    const repeat = await dismissIssue(ctx, {
      node: SKILL_NODE.path,
      analyzer: `core/${ANALYZER}`,
      value: VALUE,
    });
    assert.deepEqual(repeat, { outcome: 'already-suppressed', deletedIssues: 0 });
    const listed = await listIssueSuppressions(ctx, { node: SKILL_NODE.path });
    assert.equal(listed.suppressions.length, 1, 'single entry after the repeat');
  });

  it('suppresses with a one-shot confirm', async () => {
    const project = await makeProject();
    const result = await dismissIssue(ctxFor(project), {
      node: SKILL_NODE.path,
      analyzer: ANALYZER,
      value: VALUE,
      confirm: true,
    });
    assert.deepEqual(result, { outcome: 'suppressed', deletedIssues: 0 });
  });

  it('hard-blocks under allowSidecarWriters: false even with confirm', async () => {
    const project = await makeProject();
    forbidSidecarWriters(project);
    await assert.rejects(
      () =>
        dismissIssue(ctxFor(project), {
          node: SKILL_NODE.path,
          analyzer: ANALYZER,
          value: VALUE,
          confirm: true,
        }),
      (err: unknown) => err instanceof McpError && /allowSidecarWriters/.test(err.message),
    );
  });

  it('an unknown node is an invalid-params McpError', async () => {
    const project = await makeProject();
    await assert.rejects(
      () =>
        dismissIssue(ctxFor(project), {
          node: 'nope/ghost.md',
          analyzer: ANALYZER,
          value: VALUE,
          confirm: true,
        }),
      McpError,
    );
  });
});

describe('mcp undismiss_issue (sidecar) consent', () => {
  it('removes the matching entry under a standing grant, echoing what was removed', async () => {
    const project = await makeProject();
    grantConsent(project);
    const ctx = ctxFor(project);
    await dismissIssue(ctx, { node: SKILL_NODE.path, analyzer: ANALYZER, value: VALUE });
    assert.match(readFileSync(sidecarAbs(project), 'utf8'), /reference-broken/);

    const result = await undismissIssue(ctx, {
      node: SKILL_NODE.path,
      analyzer: ANALYZER,
      value: VALUE,
    });
    assert.deepEqual(result, {
      outcome: 'unsuppressed',
      removed: { analyzer: ANALYZER, value: VALUE },
    });
    assert.doesNotMatch(readFileSync(sidecarAbs(project), 'utf8'), /reference-broken/);
    assert.deepEqual(await listIssueSuppressions(ctx, { node: SKILL_NODE.path }), {
      suppressions: [],
    });
  });

  it('reports not-found when the pair was never suppressed, and for an unknown node', async () => {
    const project = await makeProject();
    const ctx = ctxFor(project);
    assert.deepEqual(
      await undismissIssue(ctx, { node: SKILL_NODE.path, analyzer: ANALYZER, value: VALUE }),
      { outcome: 'not-found' },
    );
    assert.deepEqual(
      await undismissIssue(ctx, { node: 'nope/ghost.md', analyzer: ANALYZER, value: VALUE }),
      { outcome: 'not-found' },
    );
  });
});

describe('mcp list_issue_suppressions (read)', () => {
  it('lists one node\'s entries, and every node\'s when node is omitted', async () => {
    const project = await makeProject();
    grantConsent(project);
    const ctx = ctxFor(project);
    await dismissIssue(ctx, { node: SKILL_NODE.path, analyzer: ANALYZER, value: VALUE });
    await dismissIssue(ctx, { node: SKILL_NODE.path, analyzer: 'schema-violation', value: 'x' });

    const scoped = await listIssueSuppressions(ctx, { node: SKILL_NODE.path });
    assert.equal(scoped.suppressions.length, 2);
    assert.ok(scoped.suppressions.every((s) => s.node === SKILL_NODE.path));

    const all = await listIssueSuppressions(ctx, {});
    assert.equal(all.suppressions.length, 2);
  });

  it('an empty project lists nothing', async () => {
    const project = await makeProject();
    assert.deepEqual(await listIssueSuppressions(ctxFor(project), {}), { suppressions: [] });
  });
});
