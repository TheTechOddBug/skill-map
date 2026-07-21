/**
 * `GET /api/nodes/:pathB64/summary` integration tests (the inspector
 * header's semantic-analysis read, `spec/cli-contract.md` §Serve route
 * table): direct shape, per-row stale derivation, empty-vs-404 rules.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { encodeNodePath } from '../../path-codec.js';
import {
  bootAndUse,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  withProjectDb,
  type IProbProject,
} from './helpers/prob-fixture.js';

interface ISummaryPayload {
  items: Array<{
    summarizerActionId: string;
    generatedAt: number;
    stale: boolean;
    report: Record<string, unknown>;
  }>;
}

let tmpRoot: string;
let project: IProbProject;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-node-summary-'));
  project = await setupProbProject(join(tmpRoot, 'proj'), [SKILL_NODE], {
    installSkill: false,
  });
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function url(handle: Parameters<typeof serverUrl>[0], path: string): string {
  return serverUrl(handle, `/api/nodes/${encodeNodePath(path)}/summary`);
}

describe('GET /api/nodes/:pathB64/summary', () => {
  it('empty items for a never-summarized node; 404 for an unknown one', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await fetch(url(handle, SKILL_NODE.path));
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()) as ISummaryPayload, { items: [] });

      const missing = await fetch(url(handle, 'nope.md'));
      assert.equal(missing.status, 404);
    });
  });

  it('returns stored summaries with the stale flag derived per row', async () => {
    // Seed two rows directly (the record path stamps the LIVE body hash,
    // so a stale row can only be planted at the table level): one fresh
    // (live hash) and one whose judged body drifted.
    await withProjectDb(project, async (adapter) => {
      const bundle = await adapter.scans.findNode(SKILL_NODE.path);
      const seed = (summarizerActionId: string, bodyHash: string, subject: string) =>
        adapter.db
          .insertInto('state_summaries')
          .values({
            nodeId: SKILL_NODE.path,
            kind: 'skill',
            summarizerActionId,
            summarizerVersion: '1.0.0',
            bodyHashAtGeneration: bodyHash,
            generatedAt: 1000,
            model: null,
            summaryJson: JSON.stringify({ whatItCovers: subject, topics: ['deploy'] }),
          })
          .execute();
      await seed('core/ai-summarizer-action', bundle!.node.bodyHash, 'Deploys the service.');
      await seed('other/summarizer', 'f'.repeat(64), 'Old view of the file.');
    });

    await bootAndUse(project, async (handle) => {
      const res = await fetch(url(handle, SKILL_NODE.path));
      assert.equal(res.status, 200);
      const payload = (await res.json()) as ISummaryPayload;
      assert.equal(payload.items.length, 2);
      const byId = new Map(payload.items.map((i) => [i.summarizerActionId, i]));
      assert.equal(byId.get('core/ai-summarizer-action')?.stale, false);
      assert.equal(
        byId.get('core/ai-summarizer-action')?.report['whatItCovers'],
        'Deploys the service.',
      );
      assert.equal(byId.get('other/summarizer')?.stale, true);
    });
  });
});
