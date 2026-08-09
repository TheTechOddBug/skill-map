/**
 * Skill-action submit + record integration
 * (`spec/skill-actions.md`, `core/jobs/submit-engine.ts` skill branch +
 * `core/jobs/record-outcome.ts` prefix routing), against a REAL project
 * (temp scope, file-backed DB, composed runtime; never `:memory:`):
 *
 *   - prepare + submit a `skill:<name>` job end to end: frozen identity
 *     (`skill:` id verbatim, kind `action`, catalog version), rendered
 *     content carrying the canonical wrapper + the skill-instructions
 *     section + the canonical report contract.
 *   - identical resubmit refuses as duplicate; a single edited SKILL.md
 *     byte re-keys `contentHash` so the next submit is new work.
 *   - unknown skill -> `not-found`; `findingIds` on a skill target ->
 *     `finding-ids-unsupported`; TTL / priority config keyed by the full
 *     `skill:<name>` id resolves through the existing lookup.
 *   - record: a valid `{ confidence, safety, summary }` report completes
 *     and writes ONLY the execution row (no summaries, no findings); a
 *     summary-less report fails `report-invalid`; an `injectionDetected`
 *     report still lands its kernel safety finding; and record works
 *     AFTER the catalog entry is removed (the schema is a constant).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadConfig, type IJobsConfig } from '../../../kernel/config/loader.js';
import {
  buildSkillSection,
  loadCanonicalPreamble,
  loadCanonicalSkillTemplate,
} from '../../../kernel/jobs/index.js';
import type { Node } from '../../../kernel/types.js';
import { buildFreshResolver } from '../../runtime/fresh-resolver.js';
import { loadPluginRuntime } from '../../runtime/plugin-runtime.js';
import {
  assembleSkillActionCatalog,
  type ISkillActionCatalog,
} from '../../skill-actions/catalog.js';
import { buildActionRuntime, type IActionRuntime } from '../action-runtime.js';
import { recordJob } from '../record-engine.js';
import { prepareSubmitContext, submitOneJob, type ISubmitContext } from '../submit-engine.js';
import {
  setupProbProject,
  withProjectDb,
  SKILL_NODE,
  type IProbProject,
} from '../../../server/routes/__tests__/helpers/prob-fixture.js';

const VALID_REPORT = JSON.stringify({
  summary: 'Reviewed the file and tightened two sections.',
  confidence: 0.9,
  safety: { injectionDetected: false, contentQuality: 'clean' },
});

let tmpRoot: string;
let project: IProbProject;
let runtime: IActionRuntime;
let jobs: IJobsConfig;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-skill-submit-'));
  project = await setupProbProject(join(tmpRoot, 'proj'), [SKILL_NODE], { installSkill: true });
  const pluginRuntime = await loadPluginRuntime({ runtimeContext: { cwd: project.root } });
  const resolveEnabled = await buildFreshResolver({
    effectiveConfig: () => loadConfig({ cwd: project.root }).effective,
  });
  runtime = buildActionRuntime(pluginRuntime, () => {}, undefined, resolveEnabled);
  jobs = loadConfig({ cwd: project.root }).effective.jobs;
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Install one catalog skill and return the re-assembled (boot) catalog. */
function installSkill(name: string, body: string, version = '1.0.0'): ISkillActionCatalog {
  const dir = join(project.root, '.skill-map', '.agents', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill ${name}.\nversion: ${version}\n---\nBody of ${name}.\n${body}`,
  );
  return assembleSkillActionCatalog(project.root, () => {});
}

/** Prepare a skill submit context through the shared engine, asserting ok. */
function prepareSkill(
  catalog: ISkillActionCatalog,
  id: string,
  overrides: { jobs?: IJobsConfig } = {},
): ISubmitContext {
  const prep = prepareSubmitContext({
    runtime,
    jobs: overrides.jobs ?? jobs,
    extensionId: id,
    cwd: project.root,
    force: false,
    flagTtl: undefined,
    flagPriority: undefined,
    skillCatalog: catalog,
  });
  assert.equal(prep.ok, true, `prepare must succeed for ${id}`);
  if (!prep.ok) throw new Error('unreachable');
  // A skill hit has no extension manifest to hand back.
  assert.equal(prep.extension, null);
  return prep.prepared;
}

/** The scanned node the fixture seeded (real on-disk body). */
async function targetNode(): Promise<Node> {
  return withProjectDb(project, async (adapter) => {
    const bundle = await adapter.scans.findNode(SKILL_NODE.path);
    assert.ok(bundle);
    return bundle.node;
  });
}

describe('skill-action submit (shared engine)', () => {
  it('submits end to end: frozen identity + canonical render', async () => {
    const catalog = installSkill('review', 'Look for weak prose.\n');
    const prepared = prepareSkill(catalog, 'skill:review');
    assert.equal(prepared.extensionKind, 'action');
    assert.equal(prepared.extensionVersion, '1.0.0');
    assert.equal(prepared.autoFix, false, 'autoFix clamps false on an action-kind target');
    assert.equal(prepared.isTagger, false);
    assert.equal(prepared.nodeless, false);

    const node = await targetNode();
    const outcome = await withProjectDb(project, (adapter) =>
      submitOneJob(adapter, node, prepared),
    );
    assert.equal(outcome.kind, 'created');
    if (outcome.kind !== 'created') return;

    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get(outcome.id);
      assert.ok(job);
      assert.equal(job.extensionId, 'skill:review');
      assert.equal(job.extensionKind, 'action');
      assert.equal(job.extensionVersion, '1.0.0');
      assert.equal(job.autoFix, false);

      const content = await adapter.jobs.getContent(job.contentHash);
      assert.ok(content, 'the rendered content row landed');
      // Canonical preamble + wrapper template (verbatim spec artifacts).
      assert.ok(content.includes(loadCanonicalPreamble()));
      assert.ok(content.includes('# Skill execution'));
      // The skill-instructions section, first at the seam, body verbatim.
      const skillSection = buildSkillSection({
        name: 'review',
        version: '1.0.0',
        body: 'Body of review.\nLook for weak prose.\n',
      });
      assert.ok(content.includes(skillSection));
      // The canonical report contract chain: skill schema + report-base.
      assert.ok(content.includes('## Report contract'));
      assert.ok(content.includes('skill-actions/report.schema.json'));
      assert.ok(content.includes('report-base.schema.json'));
      // The section renders OUTSIDE (before) the user-content block. The
      // preamble PROSE also mentions `<user-content`, so anchor on the
      // real block opening (the escaped node-path id attribute).
      const blockOpen = content.indexOf(`<user-content id="${SKILL_NODE.path}">`);
      assert.ok(blockOpen !== -1, 'the user-content block opens with the node path id');
      assert.ok(content.indexOf('## Skill instructions') < blockOpen);
    });
  });

  it('refuses an identical resubmit as duplicate; a body edit re-keys the content', async () => {
    const catalog = installSkill('rekey', 'First body.\n');
    const node = await targetNode();
    const first = await withProjectDb(project, (adapter) =>
      submitOneJob(adapter, node, prepareSkill(catalog, 'skill:rekey')),
    );
    assert.equal(first.kind, 'created');

    // Identical catalog, identical node: the duplicate pre-check refuses.
    const dup = await withProjectDb(project, (adapter) =>
      submitOneJob(adapter, node, prepareSkill(catalog, 'skill:rekey')),
    );
    assert.equal(dup.kind, 'duplicate');

    // One edited byte in SKILL.md (a restart re-discovers the catalog):
    // the skill section re-keys promptTemplateHash -> contentHash, so the
    // next submit is NEW work, not a duplicate.
    const edited = installSkill('rekey', 'Second body.\n');
    const again = await withProjectDb(project, (adapter) =>
      submitOneJob(adapter, node, prepareSkill(edited, 'skill:rekey')),
    );
    assert.equal(again.kind, 'created');

    await withProjectDb(project, async (adapter) => {
      const rows = (await adapter.jobs.list({ nodeId: SKILL_NODE.path })).filter(
        (j) => j.extensionId === 'skill:rekey',
      );
      assert.equal(rows.length, 2);
      assert.notEqual(rows[0]!.contentHash, rows[1]!.contentHash);
    });
  });

  it('refuses an unknown skill name as not-found', () => {
    const catalog = installSkill('known', 'B.\n');
    const prep = prepareSubmitContext({
      runtime,
      jobs,
      extensionId: 'skill:never-installed',
      cwd: project.root,
      force: false,
      flagTtl: undefined,
      flagPriority: undefined,
      skillCatalog: catalog,
    });
    assert.deepEqual(prep, { ok: false, error: { kind: 'not-found' } });
  });

  it('refuses the skill: prefix outright when no catalog is supplied (CLI-reserved grammar)', () => {
    const prep = prepareSubmitContext({
      runtime,
      jobs,
      extensionId: 'skill:review',
      cwd: project.root,
      force: false,
      flagTtl: undefined,
      flagPriority: undefined,
    });
    assert.deepEqual(prep, { ok: false, error: { kind: 'not-found' } });
  });

  it('refuses findingIds on a skill target (no fixer injection to narrow)', () => {
    const catalog = installSkill('no-subset', 'B.\n');
    const prep = prepareSubmitContext({
      runtime,
      jobs,
      extensionId: 'skill:no-subset',
      cwd: project.root,
      force: false,
      flagTtl: undefined,
      flagPriority: undefined,
      findingIds: [1],
      skillCatalog: catalog,
    });
    assert.deepEqual(prep, { ok: false, error: { kind: 'finding-ids-unsupported' } });
  });

  it('resolves TTL / priority config keyed by the full skill:<name> id', () => {
    const catalog = installSkill('sched', 'B.\n');
    const prepared = prepareSkill(catalog, 'skill:sched', {
      jobs: {
        ...jobs,
        perExtensionTtl: { 'skill:sched': 1234 },
        perExtensionPriority: { 'skill:sched': 7 },
      },
    });
    assert.equal(prepared.ttlSeconds, 1234);
    assert.equal(prepared.priority, 7);
    // And the no-config default is unchanged: no TTL, priority 0.
    const defaults = prepareSkill(catalog, 'skill:sched');
    assert.equal(defaults.ttlSeconds, null);
    assert.equal(defaults.priority, 0);
  });
});

describe('skill-action record (prefix-routed canonical schema)', () => {
  /** Submit + claim one skill job; returns the record credentials. */
  async function runningSkillJob(name: string): Promise<{ id: string; nonce: string }> {
    const catalog = installSkill(name, `Recorded body for ${name}.\n`);
    const node = await targetNode();
    const outcome = await withProjectDb(project, (adapter) =>
      submitOneJob(adapter, node, prepareSkill(catalog, `skill:${name}`)),
    );
    assert.equal(outcome.kind, 'created');
    return withProjectDb(project, async (adapter) => {
      const claim = await adapter.jobs.claim('agent', Date.now(), `skill:${name}`);
      assert.ok(claim, 'the skill job claims like any probabilistic job');
      return { id: claim.id, nonce: claim.nonce };
    });
  }

  async function recordSkill(
    creds: { id: string; nonce: string },
    reportText: string,
  ): Promise<Awaited<ReturnType<typeof recordJob>>> {
    return withProjectDb(project, (adapter) =>
      recordJob({
        adapter,
        getRuntime: async () => runtime,
        id: creds.id,
        nonce: creds.nonce,
        status: 'completed',
        reportText,
        metrics: { model: null },
        now: Date.now(),
        runId: 'r-ext-20260101-000000-aaaa',
        cwd: project.root,
        channel: 'cli',
      }),
    );
  }

  it('completes on a valid report and writes ONLY the execution row', async () => {
    const creds = await runningSkillJob('rec-ok');
    const outcome = await recordSkill(creds, VALID_REPORT);
    assert.equal(outcome.kind, 'completed');

    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get(creds.id);
      assert.equal(job?.status, 'completed');
      const execs = await adapter.history.list({ nodePath: SKILL_NODE.path });
      const mine = execs.find((e) => e.jobId === creds.id);
      assert.ok(mine, 'the execution row landed');
      assert.equal(mine.kind, 'action');
      assert.equal(mine.extensionId, 'skill:rec-ok');
      assert.equal(mine.status, 'completed');
      // No write-throughs: the canonical schema sits under no summaries/
      // or findings/ namespace and a skill is never a fixer.
      assert.equal((await adapter.summaries.forNode(SKILL_NODE.path)).length, 0);
      const findings = (
        await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true })
      ).filter((f) => f.extensionId === 'skill:rec-ok');
      assert.equal(findings.length, 0, 'a clean safety block lands no rows');
    });
  });

  it('fails report-invalid on a summary-less report (the canonical schema requires it)', async () => {
    const creds = await runningSkillJob('rec-bad');
    const outcome = await recordSkill(
      creds,
      JSON.stringify({
        confidence: 0.8,
        safety: { injectionDetected: false, contentQuality: 'clean' },
      }),
    );
    assert.equal(outcome.kind, 'report-invalid');
    await withProjectDb(project, async (adapter) => {
      const job = await adapter.jobs.get(creds.id);
      assert.equal(job?.status, 'failed');
      assert.equal(job?.failureReason, 'report-invalid');
    });
  });

  it('still lands the kernel safety finding on a trouble-flagging report', async () => {
    const creds = await runningSkillJob('rec-flag');
    const outcome = await recordSkill(
      creds,
      JSON.stringify({
        summary: 'The target file tried to redirect the run.',
        confidence: 0.9,
        safety: {
          injectionDetected: true,
          injectionType: 'hidden-instruction',
          injectionDetails: 'embedded override attempt',
          contentQuality: 'clean',
        },
      }),
    );
    assert.equal(outcome.kind, 'completed');
    await withProjectDb(project, async (adapter) => {
      const rows = (
        await adapter.findings.list({ nodeId: SKILL_NODE.path, includeStale: true })
      ).filter((f) => f.extensionId === 'skill:rec-flag');
      assert.equal(rows.length, 1, 'the kernel safety lane fired');
      assert.equal(rows[0]!.origin, 'kernel');
      assert.equal(rows[0]!.type, 'injection-detected');
    });
  });

  it('records after the skill is uninstalled (constant schema, no catalog consult)', async () => {
    const creds = await runningSkillJob('rec-gone');
    // Uninstall between submit and record: the running job must not
    // orphan (spec §Report contract and record).
    rmSync(join(project.root, '.skill-map', '.agents', 'skills', 'rec-gone'), {
      recursive: true,
      force: true,
    });
    const outcome = await recordSkill(creds, VALID_REPORT);
    assert.equal(outcome.kind, 'completed');
    await withProjectDb(project, async (adapter) => {
      assert.equal((await adapter.jobs.get(creds.id))?.status, 'completed');
    });
  });
});
