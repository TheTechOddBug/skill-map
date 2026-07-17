/**
 * `GET /api/nodes/:pathB64/findings` integration tests (Step 16 piece 1).
 *
 * Boots a real `createServer()` against a primed project (fixture
 * plugins + a scanned skill node + seeded `state_findings` rows) and
 * asserts the contract from `spec/cli-contract.md` §Serve route table:
 *
 *   - default view = the needs-attention rows (open + non-stale
 *     `human-decision`), with the `counts.fixedExcluded` /
 *     `counts.staleExcluded` honesty pair reporting what was held back.
 *   - `?fixed=1` / `?stale=1` are bucket FILTERS (only that bucket,
 *     union together), both excluded counts 0 under a bucket filter.
 *   - item shape = the `sm findings --json` row projection; the internal
 *     `bodyHashAtGeneration` never reaches the wire.
 *   - the 200 envelope validates against `rest-envelope.schema.json`
 *     (`kind: 'findings'` list variant).
 *   - malformed `pathB64` / unknown node / missing DB -> 404 `not-found`.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { encodeNodePath } from '../../path-codec.js';
import {
  bootAndUse,
  compileEnvelopeValidator,
  FINDER_ID,
  seedFindings,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  withProjectDb,
  type IProbProject,
} from './helpers/prob-fixture.js';

const STALE_HASH = 'd'.repeat(64);

interface IFindingsEnvelope {
  schemaVersion: string;
  kind: string;
  items: Array<Record<string, unknown>>;
  filters: Record<string, unknown>;
  counts: {
    total: number;
    returned: number;
    fixedExcluded: number;
    staleExcluded: number;
  };
}

let tmpRoot: string;
let project: IProbProject;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-node-findings-'));
  project = await setupProbProject(tmpRoot, [SKILL_NODE], { installSkill: true });

  // Four rows on the skill node, one per bucket:
  //   open-fresh     -> default view
  //   to-fix         -> resolved to `fixed` below (hidden, --fixed bucket)
  //   open-stale     -> stale bucket (bodyHashAtGeneration drifted)
  //   human-decision -> default view (needs-attention, author's TODO)
  await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
    { type: 'open-fresh' },
    { type: 'to-fix' },
    { type: 'open-stale', bodyHashAtGeneration: STALE_HASH },
    { type: 'needs-author' },
  ]);
  await withProjectDb(project, async (adapter) => {
    const all = await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true });
    const toFix = all.find((f) => f.type === 'to-fix');
    assert.ok(toFix, 'seeded to-fix row present');
    await adapter.findings.resolveByHuman(toFix.id, 'handled', Date.now());
    await adapter.db
      .updateTable('state_findings')
      .set({ resolution: 'human-decision', resolutionNote: 'author must pick' })
      .where('type', '=', 'needs-author')
      .execute();
  });
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function findingsUrl(handle: Parameters<typeof serverUrl>[0], query = ''): string {
  return serverUrl(handle, `/api/nodes/${encodeNodePath(SKILL_NODE.path)}/findings${query}`);
}

function types(env: IFindingsEnvelope): string[] {
  return env.items.map((i) => i['type'] as string).sort();
}

describe('GET /api/nodes/:pathB64/findings', () => {
  it('default view: needs-attention rows only, honest excluded counts', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await fetch(findingsUrl(handle));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IFindingsEnvelope;
      assert.equal(env.kind, 'findings');
      assert.deepEqual(types(env), ['needs-author', 'open-fresh']);
      assert.equal(env.counts.total, 2);
      assert.equal(env.counts.returned, 2);
      assert.equal(env.counts.fixedExcluded, 1);
      assert.equal(env.counts.staleExcluded, 1);
      assert.deepEqual(env.filters, { fixed: false, stale: false });
      // The internal stamp never reaches the wire; the derived `stale`
      // boolean and the resolution fields do.
      for (const item of env.items) {
        assert.equal('bodyHashAtGeneration' in item, false);
        assert.equal(typeof item['stale'], 'boolean');
        assert.equal(item['nodeId'], SKILL_NODE.path);
      }
    });
  });

  it('?fixed=1 is a bucket FILTER: only the fixed bucket, excluded counts 0', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await fetch(findingsUrl(handle, '?fixed=1'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IFindingsEnvelope;
      assert.deepEqual(types(env), ['to-fix']);
      assert.equal(env.items[0]!['resolution'], 'fixed');
      assert.equal(env.items[0]!['resolutionActor'], 'human');
      assert.equal(env.counts.fixedExcluded, 0);
      assert.equal(env.counts.staleExcluded, 0);
      assert.deepEqual(env.filters, { fixed: true, stale: false });
    });
  });

  it('?stale=1 shows only the non-fixed stale bucket', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await fetch(findingsUrl(handle, '?stale=1'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IFindingsEnvelope;
      assert.deepEqual(types(env), ['open-stale']);
      assert.equal(env.items[0]!['stale'], true);
      assert.equal(env.counts.fixedExcluded, 0);
      assert.equal(env.counts.staleExcluded, 0);
    });
  });

  it('?fixed=1&stale=1 is the union of the two buckets', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await fetch(findingsUrl(handle, '?fixed=1&stale=1'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IFindingsEnvelope;
      assert.deepEqual(types(env), ['open-stale', 'to-fix']);
    });
  });

  it('200 envelope validates against rest-envelope.schema.json (findings variant)', async () => {
    const validate = compileEnvelopeValidator();
    await bootAndUse(project, async (handle) => {
      for (const query of ['', '?fixed=1', '?stale=1']) {
        const res = await fetch(findingsUrl(handle, query));
        assert.equal(res.status, 200);
        const env = await res.json();
        assert.equal(
          validate(env),
          true,
          `envelope (${query || 'default'}) must validate: ${JSON.stringify(validate.errors)}`,
        );
      }
    });
  });

  it('404: malformed pathB64 and unknown node', async () => {
    await bootAndUse(project, async (handle) => {
      const malformed = await fetch(serverUrl(handle, '/api/nodes/%2e%2e/findings'));
      assert.equal(malformed.status, 404);
      const malformedBody = (await malformed.json()) as { error: { code: string } };
      assert.equal(malformedBody.error.code, 'not-found');

      const unknown = await fetch(
        serverUrl(handle, `/api/nodes/${encodeNodePath('docs/never.md')}/findings`),
      );
      assert.equal(unknown.status, 404);
      const unknownBody = (await unknown.json()) as { error: { code: string } };
      assert.equal(unknownBody.error.code, 'not-found');
    });
  });

  it('404: missing DB', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'skill-map-node-findings-nodb-'));
    try {
      const bareProject = { root: bare, dbPath: join(bare, '.skill-map', 'skill-map.db') };
      await bootAndUse(bareProject, async (handle) => {
        const res = await fetch(findingsUrl(handle));
        assert.equal(res.status, 404);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, 'not-found');
      });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
