/**
 * `GET /api/nodes/:pathB64/prob-extensions` integration tests
 * (Step 16 piece 1).
 *
 * Exercises the manifest-mechanical classification against the fixture
 * plugins (`prob-finder` = probabilistic Analyzer with a `claude/skill`
 * precondition, `prob-fixer` = probabilistic Action declaring
 * `precondition.analyzerIds`, `prob-summarizer` = probabilistic Action
 * without `analyzerIds`):
 *
 *   - finder + standalone always listed on a matching node; the finder
 *     is NOT listed on a node its precondition rejects.
 *   - the FIXER is listed ONLY once the node carries >= 1 matching
 *     finding (STALE included), with the tally on `findingCount`.
 *   - `state` reflects the live `state_jobs` row for the pair
 *     (`queued` after a submit, `idle` otherwise); `jobId` carries the
 *     ACTIVE row's id (the cancel handle), `null` when idle.
 *   - `lastJudged` carries `{ at, model }` of the latest COMPLETED
 *     execution, `null` when the pair was never judged.
 *   - a VIRTUAL node answers 200 with three empty arrays.
 *   - the 200 envelope validates against `rest-envelope.schema.json`
 *     (`kind: 'node.prob-extensions'` single variant).
 *   - malformed `pathB64` / unknown node -> 404.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { encodeNodePath } from '../../path-codec.js';
import type { IProbExtensionEntry, IProbExtensionsCatalog } from '../node-prob-extensions.js';
import {
  bootAndUse,
  compileEnvelopeValidator,
  FINDER_ID,
  FIXER_ID,
  seedFindings,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  SUMMARIZER_ID,
  withProjectDb,
  type IProbProject,
} from './helpers/prob-fixture.js';

const STALE_HASH = 'e'.repeat(64);
const NOTE_NODE = { path: 'notes/readme.md', kind: 'markdown', provider: 'markdown' } as const;
const VIRTUAL_NODE = {
  path: 'virtual/agent.md',
  kind: 'agent',
  provider: 'claude',
  virtual: true,
} as const;

interface IProbExtensionsEnvelope {
  schemaVersion: string;
  kind: string;
  item: IProbExtensionsCatalog;
}

let tmpRoot: string;
let project: IProbProject;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-prob-ext-'));
  project = await setupProbProject(tmpRoot, [SKILL_NODE, NOTE_NODE, VIRTUAL_NODE], {
    installSkill: true,
  });
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function catalogUrl(handle: Parameters<typeof serverUrl>[0], nodePath: string): string {
  return serverUrl(handle, `/api/nodes/${encodeNodePath(nodePath)}/prob-extensions`);
}

async function fetchCatalog(
  handle: Parameters<typeof serverUrl>[0],
  nodePath: string,
): Promise<IProbExtensionsEnvelope> {
  const res = await fetch(catalogUrl(handle, nodePath));
  assert.equal(res.status, 200);
  return (await res.json()) as IProbExtensionsEnvelope;
}

function byId(entries: readonly IProbExtensionEntry[], id: string): IProbExtensionEntry | undefined {
  return entries.find((e) => e.id === id);
}

describe('GET /api/nodes/:pathB64/prob-extensions', () => {
  it('classifies finder + standalone on a matching node; fixer hidden without findings', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, SKILL_NODE.path);
      assert.equal(env.kind, 'node.prob-extensions');

      const finder = byId(env.item.finders, FINDER_ID);
      assert.ok(finder, 'prob-finder/quality-check listed as finder');
      assert.equal(finder.state, 'idle');
      assert.equal(finder.jobId, null, 'idle pair exposes no cancel handle');
      assert.equal(finder.lastJudged, null);
      assert.equal('findingCount' in finder, false);
      assert.ok(finder.description.length > 0);

      const standalone = byId(env.item.standalone, SUMMARIZER_ID);
      assert.ok(standalone, 'prob-summarizer/skill-echo listed as standalone');
      assert.equal('findingCount' in standalone, false);

      // No findings seeded yet: the fixer launcher stays hidden,
      // mirroring the kernel's no-findings submit refusal.
      assert.equal(byId(env.item.fixers, FIXER_ID), undefined);
    });
  });

  it('finder is NOT listed on a node its precondition rejects', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, NOTE_NODE.path);
      assert.equal(byId(env.item.finders, FINDER_ID), undefined);
      // The summarizer's `claude/skill` precondition rejects it too.
      assert.equal(byId(env.item.standalone, SUMMARIZER_ID), undefined);
    });
  });

  it('fixer appears with STALE-only findings, findingCount carries the tally', async () => {
    await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
      { type: 'stale-a', bodyHashAtGeneration: STALE_HASH },
      { type: 'stale-b', bodyHashAtGeneration: STALE_HASH },
    ]);
    try {
      await bootAndUse(project, async (handle) => {
        const env = await fetchCatalog(handle, SKILL_NODE.path);
        const fixer = byId(env.item.fixers, FIXER_ID);
        assert.ok(fixer, 'fixer visible once its analyzer lane has findings (stale included)');
        assert.equal(fixer.findingCount, 2);
        assert.equal(fixer.state, 'idle');
      });
    } finally {
      // Erase the pair's rows (clean verdict) so later suites see the
      // findings-free baseline again.
      await seedFindings(project, SKILL_NODE.path, FINDER_ID, []);
    }
  });

  it('state + jobId reflect the live queue; lastJudged the latest completed execution', async () => {
    const judgedAt = Date.now() - 1000;
    await withProjectDb(project, async (adapter) => {
      await adapter.jobs.submit(
        {
          id: 'd-20260717-000000-aaaa',
          extensionId: SUMMARIZER_ID,
          extensionVersion: '1.0.0',
          extensionKind: 'action',
          nodeId: SKILL_NODE.path,
          contentHash: 'c'.repeat(64),
          nonce: 'n'.repeat(32),
          priority: 0,
          status: 'queued',
          ttlSeconds: null,
          createdAt: Date.now(),
        },
        { contentHash: 'c'.repeat(64), content: 'rendered', createdAt: Date.now() },
      );
      await adapter.history.insertExecution({
        id: 'e-20260717-000000-aaaa',
        kind: 'action',
        extensionId: FINDER_ID,
        extensionVersion: '1.0.0',
        nodeIds: [SKILL_NODE.path],
        status: 'completed',
        startedAt: judgedAt - 500,
        finishedAt: judgedAt,
        model: 'test-model',
      });
    });
    try {
      await bootAndUse(project, async (handle) => {
        const env = await fetchCatalog(handle, SKILL_NODE.path);
        const standalone = byId(env.item.standalone, SUMMARIZER_ID);
        assert.ok(standalone);
        assert.equal(standalone.state, 'queued');
        assert.equal(
          standalone.jobId,
          'd-20260717-000000-aaaa',
          'the active row id is the cancel handle',
        );

        const finder = byId(env.item.finders, FINDER_ID);
        assert.ok(finder);
        assert.equal(finder.jobId, null);
        assert.deepEqual(finder.lastJudged, { at: judgedAt, model: 'test-model' });
      });
    } finally {
      await withProjectDb(project, async (adapter) => {
        await adapter.jobs.cancelAllActive(Date.now());
      });
    }
  });

  it('virtual node: 200 with three empty arrays', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, VIRTUAL_NODE.path);
      assert.deepEqual(env.item, { finders: [], fixers: [], standalone: [] });
    });
  });

  it('200 envelope validates against rest-envelope.schema.json (single variant)', async () => {
    const validate = compileEnvelopeValidator();
    await bootAndUse(project, async (handle) => {
      const res = await fetch(catalogUrl(handle, SKILL_NODE.path));
      assert.equal(res.status, 200);
      const env = await res.json();
      assert.equal(
        validate(env),
        true,
        `envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });
  });

  it('404: malformed pathB64 and unknown node', async () => {
    await bootAndUse(project, async (handle) => {
      const malformed = await fetch(serverUrl(handle, '/api/nodes/!!!/prob-extensions'));
      assert.equal(malformed.status, 404);

      const unknown = await fetch(catalogUrl(handle, 'docs/never.md'));
      assert.equal(unknown.status, 404);
      const body = (await unknown.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'not-found');
    });
  });
});
