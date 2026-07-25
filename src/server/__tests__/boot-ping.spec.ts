/**
 * Boot liveness ping (`server/boot-ping.ts`) contract tests.
 *
 * Scope is deliberately narrow: the ping is best-effort TRAFFIC, not a
 * state machine, and its real payoff (an agent claiming it) is observed
 * through the same passive path as any other claim, so no agent is booted
 * here. What MUST hold is that it queues exactly one hidden system job
 * against a real node, cleans it up when nobody claims it, and otherwise
 * never throws and never speaks.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { emptyPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import { PING_EXTENSION_ID, runBootPing, startBootPing } from '../boot-ping.js';
import {
  setupProbProject,
  SKILL_NODE,
  withProjectDb,
  type INodeSeed,
  type IProbProject,
} from '../routes/__tests__/helpers/prob-fixture.js';

const roots: string[] = [];
let counter = 0;

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-map-boot-ping-'));
  roots.push(root);
  return root;
}

/** A primed project (real node bodies on disk + the processing skill). */
async function pingableProject(nodes: readonly INodeSeed[] = [SKILL_NODE]): Promise<IProbProject> {
  counter += 1;
  return setupProbProject(join(tempProject(), `p-${counter}`), nodes, { installSkill: true });
}

/** Deps for a project; built-ins only (the ping's target is a locked built-in). */
function depsFor(project: IProbProject, timeoutMsOverride?: number): Parameters<typeof runBootPing>[0] {
  return {
    dbPath: project.dbPath,
    cwd: project.root,
    pluginRuntime: emptyPluginRuntime(),
    ...(timeoutMsOverride !== undefined ? { timeoutMsOverride } : {}),
  };
}

/**
 * Poll the project's single job until it reaches `want` (or give up).
 * The ping's submit + cleanup are detached, so the assertion waits on the
 * state instead of on a fixed sleep.
 */
async function waitForStatus(project: IProbProject, want: string): Promise<string | null> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const jobs = await withProjectDb(project, (adapter) => adapter.jobs.list({}));
    const status = jobs[0]?.status ?? null;
    if (status === want) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('boot ping', () => {
  it('skips silently when no processing skill is installed', async () => {
    const cwd = tempProject();
    const jobId = await runBootPing({
      dbPath: join(cwd, '.skill-map', 'skill-map.db'),
      cwd,
      pluginRuntime: emptyPluginRuntime(),
    });
    assert.equal(jobId, null);
  });

  it('never throws, even against a project root that does not exist', async () => {
    const cwd = join(tempProject(), 'does', 'not', 'exist');
    const jobId = await runBootPing({
      dbPath: join(cwd, 'skill-map.db'),
      cwd,
      pluginRuntime: emptyPluginRuntime(),
    });
    assert.equal(jobId, null);
  });

  it('queues ONE hidden ping job against the first real node', async () => {
    const project = await pingableProject();
    const jobId = await runBootPing(depsFor(project));
    assert.ok(jobId !== null);
    const jobs = await withProjectDb(project, (adapter) => adapter.jobs.list({}));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, jobId);
    assert.equal(jobs[0]?.extensionId, PING_EXTENSION_ID);
    assert.equal(jobs[0]?.nodeId, SKILL_NODE.path);
    assert.equal(jobs[0]?.status, 'queued');
  });

  /**
   * A ping is only cancelled by the timer of the server that submitted it,
   * so one whose server died first stays queued forever. The boot sweep
   * retires every QUEUED leftover before submitting, so restarts can never
   * pile pings up, and unlike the duplicate-adopt path it does not depend
   * on this boot targeting the same node and body as the last one.
   */
  it('retires a previous boot\'s queued ping instead of piling pings up', async () => {
    const project = await pingableProject();
    const first = await runBootPing(depsFor(project));
    const second = await runBootPing(depsFor(project));

    assert.ok(first !== null && second !== null);
    const jobs = await withProjectDb(project, (adapter) => adapter.jobs.list({}));
    // Exactly one ping is claimable: the old row survives as `cancelled`
    // history, never as work an agent could still pick up.
    const queued = jobs.filter((j) => j.status === 'queued');
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.id, second);
    const prior = jobs.find((j) => j.id === first);
    if (first !== second) assert.equal(prior?.status, 'cancelled');
  });

  it('skips a corpus with no real node to aim at', async () => {
    const project = await pingableProject([
      { path: 'mcp://demo', kind: 'mcp', provider: 'claude', virtual: true },
    ]);
    assert.equal(await runBootPing(depsFor(project)), null);
    const jobs = await withProjectDb(project, (adapter) => adapter.jobs.list({}));
    assert.equal(jobs.length, 0);
  });

  it('cancels the ping when it is still queued after the window', async () => {
    const project = await pingableProject();
    const handle = startBootPing(depsFor(project, 5));
    // Submit + timer + cancel are all sub-millisecond DB work; poll for
    // the terminal state instead of sleeping on a fixed budget.
    const status = await waitForStatus(project, 'cancelled');
    handle.stop();
    assert.equal(status, 'cancelled');
  });

  it('returns a handle whose stop() is safe and idempotent', () => {
    const cwd = tempProject();
    const handle = startBootPing({
      dbPath: join(cwd, '.skill-map', 'skill-map.db'),
      cwd,
      pluginRuntime: emptyPluginRuntime(),
      timeoutMsOverride: 10,
    });
    handle.stop();
    handle.stop();
  });
});
