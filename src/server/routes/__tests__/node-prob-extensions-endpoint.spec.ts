/**
 * `GET /api/nodes/:pathB64/prob-extensions` integration tests (Step 16).
 *
 * Exercises the manifest-mechanical classification into the two-bucket
 * `{ finders, standalone }` catalog against the fixture plugins
 * (`prob-finder/quality-check` = probabilistic Analyzer with a
 * `claude/skill` precondition, `prob-fixer/apply-fix` = probabilistic
 * Action declaring `precondition.analyzerIds: ['prob-finder/quality-check']`,
 * `prob-summarizer/skill-echo` = probabilistic Action without
 * `analyzerIds`). The built-in probabilistic quality analyzers + their
 * fixers ship experimental (disabled), so the composed set is exactly the
 * trusted drop-ins plus the enabled `core/ai-summarizer-action`.
 *
 *   - a finder WITH a matching fixer lands in `finders`, carrying
 *     `fixerIds` (the inverse Modelo-B lookup) and `hasOpenFindings`
 *     (the Detect <-> Fix morph driver).
 *   - a probabilistic Action WITHOUT `analyzerIds` lands in `standalone`
 *     with an empty `fixerIds` and `hasOpenFindings: false`.
 *   - a FIXER Action (WITH `analyzerIds`) is NOT listed in any bucket:
 *     it is the second state of its finder's button, not a launcher.
 *   - a finder whose only fixer is NOT composed (untrusted) falls to
 *     `standalone` with empty `fixerIds`.
 *   - `hasOpenFindings` tracks the finder lane: an open non-stale finding
 *     of the finder's own id flips it true; a `fixed` or stale finding
 *     leaves it false.
 *   - `state` / `jobId` reflect the live `state_jobs` row; `lastJudged`
 *     the latest COMPLETED execution.
 *   - a VIRTUAL node answers 200 with two empty arrays.
 *   - the 200 envelope validates against `rest-envelope.schema.json`.
 *   - malformed `pathB64` / unknown node -> 404.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it('finder-with-fixer -> finders (carrying fixerIds); summarizer -> standalone', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, SKILL_NODE.path);
      assert.equal(env.kind, 'node.prob-extensions');

      const finder = byId(env.item.finders, FINDER_ID);
      assert.ok(finder, 'prob-finder/quality-check listed as a finder (it has a fixer)');
      assert.equal(finder.state, 'idle');
      assert.equal(finder.jobId, null, 'idle pair exposes no cancel handle');
      assert.equal(finder.lastJudged, null);
      assert.deepEqual(finder.fixerIds, [FIXER_ID], 'its inverse Modelo-B fixer');
      assert.equal(finder.hasOpenFindings, false, 'no findings seeded yet');
      assert.ok(finder.description.length > 0);

      const standalone = byId(env.item.standalone, SUMMARIZER_ID);
      assert.ok(standalone, 'prob-summarizer/skill-echo listed as standalone');
      assert.deepEqual(standalone.fixerIds, [], 'a standalone Action has no fixer');
      assert.equal(standalone.hasOpenFindings, false, 'standalone entries are never in Fix state');
    });
  });

  it('a fixer Action is listed in NO bucket (it is the finder button second state)', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, SKILL_NODE.path);
      assert.equal(byId(env.item.finders, FIXER_ID), undefined);
      assert.equal(byId(env.item.standalone, FIXER_ID), undefined);
    });
  });

  it('finder is NOT listed on a node its precondition rejects', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, NOTE_NODE.path);
      assert.equal(byId(env.item.finders, FINDER_ID), undefined);
      assert.equal(byId(env.item.standalone, FINDER_ID), undefined);
      // The summarizer's `claude/skill` precondition rejects it too.
      assert.equal(byId(env.item.standalone, SUMMARIZER_ID), undefined);
    });
  });

  it('finder whose only fixer is not composed falls to standalone with empty fixerIds', async () => {
    // Untrust the fixer plugin: `prob-fixer/apply-fix` is no longer
    // composed, so its finder has no actionable fixer and must land in
    // `standalone`, not `finders`.
    await withProjectDb(project, (adapter) => adapter.trust.set('prob-fixer', false));
    try {
      await bootAndUse(project, async (handle) => {
        const env = await fetchCatalog(handle, SKILL_NODE.path);
        assert.equal(byId(env.item.finders, FINDER_ID), undefined, 'no fixer -> not a finder');
        const fallen = byId(env.item.standalone, FINDER_ID);
        assert.ok(fallen, 'a finder with no composed fixer is a single Detect button');
        assert.deepEqual(fallen.fixerIds, []);
        assert.equal(fallen.hasOpenFindings, false);
      });
    } finally {
      await withProjectDb(project, (adapter) => adapter.trust.set('prob-fixer', true));
    }
  });

  it('hasOpenFindings tracks the finder lane: open -> true, fixed -> false, stale -> false', async () => {
    try {
      // Open + fresh finding of the finder's own id: the button morphs to Fix.
      await seedFindings(project, SKILL_NODE.path, FINDER_ID, [{ type: 'defect-a' }]);
      await bootAndUse(project, async (handle) => {
        const finder = byId((await fetchCatalog(handle, SKILL_NODE.path)).item.finders, FINDER_ID);
        assert.ok(finder);
        assert.equal(finder.hasOpenFindings, true, 'an open non-stale finding drives Fix state');
      });

      // Resolve it (fixed): a done finding no longer keeps the Fix state.
      await withProjectDb(project, async (adapter) => {
        const [open] = (await adapter.findings.list({ nodeId: SKILL_NODE.path })).filter(
          (r) => r.extensionId === FINDER_ID,
        );
        assert.ok(open, 'the seeded open finding is present');
        const outcome = await adapter.findings.resolveByHuman(open.id, null, Date.now());
        assert.equal(outcome.kind, 'resolved');
      });
      await bootAndUse(project, async (handle) => {
        const finder = byId((await fetchCatalog(handle, SKILL_NODE.path)).item.finders, FINDER_ID);
        assert.ok(finder);
        assert.equal(finder.hasOpenFindings, false, 'a fixed finding does not keep Fix state');
      });

      // Stale-only open finding: it awaits a re-run, not a fix.
      await seedFindings(project, SKILL_NODE.path, FINDER_ID, [
        { type: 'defect-a', bodyHashAtGeneration: STALE_HASH },
      ]);
      await bootAndUse(project, async (handle) => {
        const finder = byId((await fetchCatalog(handle, SKILL_NODE.path)).item.finders, FINDER_ID);
        assert.ok(finder);
        assert.equal(finder.hasOpenFindings, false, 'a stale finding awaits a re-run');
      });
    } finally {
      // Erase the pair's rows so later suites see the findings-free baseline.
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

  it('a queued FIXER lights its finder button (state/jobId over {finder} ∪ fixerIds)', async () => {
    // The Fix state submits the fixer, so a queued/running fixer must show
    // on the finder button, else clicking Fix looks completely ignored.
    await withProjectDb(project, async (adapter) => {
      await adapter.jobs.submit(
        {
          id: 'd-20260718-000000-ffff',
          extensionId: FIXER_ID,
          extensionVersion: '1.0.0',
          extensionKind: 'action',
          nodeId: SKILL_NODE.path,
          contentHash: 'f'.repeat(64),
          nonce: 'n'.repeat(32),
          priority: 0,
          status: 'queued',
          ttlSeconds: null,
          createdAt: Date.now(),
        },
        { contentHash: 'f'.repeat(64), content: 'rendered', createdAt: Date.now() },
      );
    });
    try {
      await bootAndUse(project, async (handle) => {
        const env = await fetchCatalog(handle, SKILL_NODE.path);
        const finder = byId(env.item.finders, FINDER_ID);
        assert.ok(finder);
        assert.equal(finder.state, 'queued', 'the fixer job lights the finder button');
        assert.equal(finder.jobId, 'd-20260718-000000-ffff', 'stop targets the fixer job');
      });
    } finally {
      await withProjectDb(project, async (adapter) => {
        await adapter.jobs.cancelAllActive(Date.now());
      });
    }
  });

  it('mid-session enable: a per-extension-disabled finder appears WITHOUT a restart', async () => {
    // A dedicated project so the settings.json mutation never leaks into
    // the shared-fixture cases above. Boot ONCE with
    // `prob-finder/quality-check` config-disabled at the extension level
    // (the plugin still loads and buckets its handler, only the leaf
    // toggle is off), then flip it through the running server's own PATCH
    // route and re-read on the SAME server, no reboot.
    const midRoot = mkdtempSync(join(tmpdir(), 'skill-map-prob-ext-live-'));
    try {
      const live = await setupProbProject(midRoot, [SKILL_NODE], { installSkill: true });
      // Commit the per-extension disable to the settings.json the running
      // server reads. The key is the LEAF extension id `quality-check`
      // (the plugin id is already the parent key), not the qualified id.
      writeFileSync(
        join(live.root, '.skill-map', 'settings.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            plugins: { 'prob-finder': { extensions: { 'quality-check': { enabled: false } } } },
          },
          null,
          2,
        ),
      );
      await bootAndUse(live, async (handle) => {
        // Before: the disabled finder is filtered out of the composed
        // set, so it is in NEITHER bucket.
        const before = await fetchCatalog(handle, SKILL_NODE.path);
        assert.equal(
          byId(before.item.finders, FINDER_ID),
          undefined,
          'a config-disabled finder is absent at boot',
        );
        assert.equal(byId(before.item.standalone, FINDER_ID), undefined);

        // Enable it through the running server's own PATCH route (writes
        // settings.json + configService.reload() inside the handler).
        const patch = await fetch(
          serverUrl(handle, '/api/plugins/prob-finder/extensions/quality-check'),
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true }),
          },
        );
        assert.equal(patch.status, 200, 'the enable PATCH succeeds');

        // After: the SAME server recomposes the finder fresh from the
        // live config, so it shows up in `finders` carrying its fixer.
        const after = await fetchCatalog(handle, SKILL_NODE.path);
        const finder = byId(after.item.finders, FINDER_ID);
        assert.ok(finder, 'the just-enabled finder appears without a restart');
        assert.deepEqual(finder.fixerIds, [FIXER_ID], 'its inverse Modelo-B fixer is composed too');
      });
    } finally {
      rmSync(midRoot, { recursive: true, force: true });
    }
  });

  it('virtual node: 200 with two empty arrays', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, VIRTUAL_NODE.path);
      assert.deepEqual(env.item, { finders: [], standalone: [] });
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
