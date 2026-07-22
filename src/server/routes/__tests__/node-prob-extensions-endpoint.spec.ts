/**
 * `GET /api/nodes/:pathB64/prob-extensions` integration tests (Step 16).
 *
 * Exercises the manifest-mechanical classification into the three-bucket
 * `{ finders, standalone, issueFixers }` catalog against the fixture plugins
 * (`prob-finder/quality-check` = probabilistic Analyzer with a
 * `claude/skill` precondition, `prob-fixer/apply-fix` = probabilistic
 * Action declaring `precondition.analyzerIds: ['prob-finder/quality-check']`,
 * `prob-summarizer/skill-echo` = probabilistic Action without
 * `analyzerIds`). The built-in `core/ai-summarizer-action` ships
 * experimental (disabled by default since 2026-07-18), so the
 * probabilistic launchers these suites classify come from the trusted
 * drop-in fixtures.
 *
 *   - a finder WITH a matching fixer lands in `finders`, carrying
 *     `fixerIds` (the inverse Modelo-B lookup) and `hasOpenFindings`
 *     (the Detect <-> Fix morph driver).
 *   - a probabilistic Action WITHOUT `analyzerIds` lands in `standalone`
 *     with an empty `fixerIds` and `hasOpenFindings: false`.
 *   - a FIXER Action pairing a PROBABILISTIC finder (WITH `analyzerIds`)
 *     is NOT listed in any bucket: it is the second state of its finder's
 *     button, not a launcher.
 *   - a FIXER Action of a DETERMINISTIC analyzer
 *     (`core/ai-reference-action` over `core/reference-broken`) lands in
 *     `issueFixers` (carrying the SHORT `analyzerIds` row-match key; user
 *     decision 2026-07-22 replacing the former standalone placement), but
 *     only when the node carries >= 1 matching `scan_issues` row; absent
 *     that Issue it is in no bucket.
 *   - a finder whose only fixer is NOT composed (untrusted) falls to
 *     `standalone` with empty `fixerIds`.
 *   - `hasOpenFindings` tracks the finder lane: an open non-stale finding
 *     of the finder's own id flips it true; a `fixed` or stale finding
 *     leaves it false.
 *   - `state` / `jobId` reflect the live `state_jobs` row; `lastJudged`
 *     the latest COMPLETED execution.
 *   - a VIRTUAL node answers 200 with three empty arrays.
 *   - the 200 envelope validates against `rest-envelope.schema.json`.
 *   - malformed `pathB64` / unknown node -> 404.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { encodeNodePath } from '../../path-codec.js';
import type { IProbExtensionsCatalog } from '../node-prob-extensions.js';
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
/** The built-in deterministic-analyzer fixer (`core/reference-broken` over `scan_issues`). */
const AI_REFERENCE_ID = 'core/ai-reference-action';
/** The built-in standalone gated by `precondition.frontmatterMissing`. */
const AI_FRONTMATTER_ID = 'core/ai-frontmatter-action';
/** The analyzerId a `reference-broken` Issue persists (SHORT, no slash per issue.schema.json). */
const REFERENCE_BROKEN_SHORT = 'reference-broken';
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

function byId<T extends { id: string }>(entries: readonly T[], id: string): T | undefined {
  return entries.find((e) => e.id === id);
}

/**
 * Explicitly enable the built-in `core/ai-reference-action` in the
 * project's settings.json. Since its graduation to stable it ships ENABLED
 * by default, so this toggle is redundant-but-harmless; it pins catalog
 * membership regardless of the shipped default. The key is the LEAF
 * extension id under its plugin (`core`).
 */
function enableAiReferenceAction(root: string): void {
  writeFileSync(
    join(root, '.skill-map', 'settings.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        plugins: { core: { extensions: { 'ai-reference-action': { enabled: true } } } },
      },
      null,
      2,
    ),
  );
}

/**
 * Enable the built-in `core/ai-frontmatter-action` (experimental, ships
 * disabled) so the `frontmatterMissing` gate cases below classify it.
 */
function enableAiFrontmatterAction(root: string): void {
  writeFileSync(
    join(root, '.skill-map', 'settings.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        plugins: { core: { extensions: { 'ai-frontmatter-action': { enabled: true } } } },
      },
      null,
      2,
    ),
  );
}

/**
 * Plant one deterministic `core/reference-broken` Issue against `nodePath`,
 * mirroring how the scan persists it: the analyzerId is stored SHORT
 * (`reference-broken`, no slash) and the node scope rides `node_ids_json`.
 */
async function seedReferenceBrokenIssue(project: IProbProject, nodePath: string): Promise<void> {
  await withProjectDb(project, async (adapter) => {
    await adapter.db
      .insertInto('scan_issues')
      .values({
        analyzerId: REFERENCE_BROKEN_SHORT,
        severity: 'error',
        nodeIdsJson: JSON.stringify([nodePath]),
        linkIndicesJson: null,
        message: 'references arrow points at "docs/missing.md" which is not in the scan',
        detail: null,
        fixJson: null,
        dataJson: JSON.stringify({ target: 'docs/missing.md', kind: 'references', trigger: null }),
      })
      .execute();
  });
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

  it('deterministic-analyzer fixer lands in issueFixers iff the node has a reference-broken Issue', async () => {
    // `core/ai-reference-action` fixes the DETERMINISTIC `core/reference-broken`
    // analyzer, which emits `scan_issues`, not `state_findings`. It has no
    // finder button to ride; it surfaces in the `issueFixers` bucket (the UI
    // renders it ON the matching issue rows, user decision 2026-07-22), gated
    // on the node actually carrying a reference-broken Issue.
    const root = mkdtempSync(join(tmpdir(), 'skill-map-prob-ext-airef-'));
    try {
      const proj = await setupProbProject(root, [SKILL_NODE], { installSkill: true });
      enableAiReferenceAction(proj.root);
      await seedReferenceBrokenIssue(proj, SKILL_NODE.path);
      await bootAndUse(proj, async (handle) => {
        const env = await fetchCatalog(handle, SKILL_NODE.path);
        const entry = byId(env.item.issueFixers, AI_REFERENCE_ID);
        assert.ok(entry, 'the deterministic-analyzer fixer surfaces in issueFixers');
        assert.deepEqual(
          entry.analyzerIds,
          [REFERENCE_BROKEN_SHORT],
          'the row-match key is the SHORT analyzer id (plugin prefix stripped)',
        );
        assert.equal(byId(env.item.standalone, AI_REFERENCE_ID), undefined, 'never standalone');
        assert.equal(byId(env.item.finders, AI_REFERENCE_ID), undefined, 'never a finder');

        // Regression: a probabilistic finder+fixer node still classifies
        // exactly as before (the deterministic-fixer branch is additive).
        const finder = byId(env.item.finders, FINDER_ID);
        assert.ok(finder, 'the probabilistic finder still lands in finders');
        assert.deepEqual(finder.fixerIds, [FIXER_ID], 'its inverse Modelo-B fixer is unchanged');
        assert.equal(byId(env.item.standalone, FINDER_ID), undefined);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('deterministic-analyzer fixer is ABSENT from every bucket with no reference-broken Issue', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-map-prob-ext-airef-none-'));
    try {
      const proj = await setupProbProject(root, [SKILL_NODE], { installSkill: true });
      enableAiReferenceAction(proj.root);
      // No reference-broken Issue seeded: nothing for the fixer to resolve.
      await bootAndUse(proj, async (handle) => {
        const env = await fetchCatalog(handle, SKILL_NODE.path);
        assert.equal(
          byId(env.item.issueFixers, AI_REFERENCE_ID),
          undefined,
          'no matching Issue -> the fixer is not listed',
        );
        assert.equal(byId(env.item.standalone, AI_REFERENCE_ID), undefined);
        assert.equal(byId(env.item.finders, AI_REFERENCE_ID), undefined);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('frontmatterMissing gate: the frontmatter action lists standalone only while a field is missing', async () => {
    // `core/ai-frontmatter-action` declares
    // `precondition.frontmatterMissing: ['name', 'description']`: it is a
    // plain standalone launcher on a node missing either field and
    // disappears once the file carries both (user call 2026-07-22).
    const root = mkdtempSync(join(tmpdir(), 'skill-map-prob-ext-fm-'));
    try {
      const missing = { path: 'notes/missing-fm.md', kind: 'markdown', provider: 'markdown' };
      const complete = {
        path: 'notes/complete-fm.md',
        kind: 'markdown',
        provider: 'markdown',
        frontmatter: { name: 'complete-fm', description: 'A complete guide.' },
      };
      const proj = await setupProbProject(root, [missing, complete], { installSkill: true });
      enableAiFrontmatterAction(proj.root);
      await bootAndUse(proj, async (handle) => {
        const gapEnv = await fetchCatalog(handle, missing.path);
        const entry = byId(gapEnv.item.standalone, AI_FRONTMATTER_ID);
        assert.ok(entry, 'missing frontmatter -> the action is a standalone launcher');
        assert.equal(byId(gapEnv.item.issueFixers, AI_FRONTMATTER_ID), undefined);

        const fullEnv = await fetchCatalog(handle, complete.path);
        assert.equal(
          byId(fullEnv.item.standalone, AI_FRONTMATTER_ID),
          undefined,
          'complete frontmatter -> the launcher hides (nothing to fill)',
        );
        assert.equal(byId(fullEnv.item.finders, AI_FRONTMATTER_ID), undefined);
        assert.equal(byId(fullEnv.item.issueFixers, AI_FRONTMATTER_ID), undefined);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('virtual node: 200 with three empty arrays', async () => {
    await bootAndUse(project, async (handle) => {
      const env = await fetchCatalog(handle, VIRTUAL_NODE.path);
      assert.deepEqual(env.item, { finders: [], standalone: [], issueFixers: [] });
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
