/**
 * End-to-end integration of the live-activity BRIDGE artifact
 * (`spec/provider-activity.md` §Bridge contract): the exact script
 * `sm activity install` writes is spawned the way a provider runtime
 * spawns a hook (raw payload on stdin), against a REAL `createServer`
 * boot with a primed DB and a real `serve.json`.
 *
 * Covered:
 *   - Happy path: real Claude Skill payload -> POST with token ->
 *     `node.activity` reaches a live `/ws` client; bridge exits 0 with
 *     EMPTY stdout (invisibility invariant).
 *   - No serve.json            -> exit 0, silent (server not running).
 *   - scopeRoot mismatch       -> exit 0, silent, NO broadcast.
 *   - Non-loopback serve.json  -> exit 0, silent, nothing sent.
 *   - Stale serve.json (server down) -> exit 0, empty stdout, at most
 *     one stderr warning line.
 */

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import type { Node, ScanResult } from '../../kernel/types.js';
import { BRIDGE_PACKAGE_JSON, renderActivityBridge } from '../../cli/util/activity-bridge.js';
import { buildServeInfo, writeServeInfo } from '../../cli/util/serve-info.js';
import {
  ACTIVITY_BRIDGE_REL,
  defaultServeInfoPath,
} from '../../core/paths/db-path.js';
import { createServer, type IServerHandle, type IServerOptions } from '../../server/index.js';

const HASH = 'a'.repeat(64);

const SKILL_PAYLOAD = {
  session_id: '6cfe5636-2e56-4271-91a6-87fc3d4355be',
  cwd: '/irrelevant/for/the/bridge',
  hook_event_name: 'PreToolUse',
  tool_name: 'Skill',
  tool_input: { skill: 'deploy' },
  tool_use_id: 'toolu_015y8G9WHeDyRfLabuUTSoeL',
};

let tmp: string;
let fixtureRoot: string;
let dbPath: string;
let bridgePath: string;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-bridge-'));
  fixtureRoot = join(tmp, 'fixture');
  dbPath = join(tmp, 'primed.db');
  bridgePath = join(fixtureRoot, ACTIVITY_BRIDGE_REL);

  mkdirSync(dirname(bridgePath), { recursive: true });
  writeFileSync(bridgePath, renderActivityBridge(), 'utf8');
  // Exactly what `sm activity install` writes next to the bridge: the
  // type pin that keeps the `.js` CommonJS under any host project.
  writeFileSync(join(dirname(bridgePath), 'package.json'), BRIDGE_PACKAGE_JSON, 'utf8');
  // REGRESSION: the host project is ESM (`"type": "module"`), the real
  // failure seen live inside the skill-map repo itself, where a bare
  // `.js` bridge parsed as ESM and `require` threw on line 1 of main.
  writeFileSync(
    join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: 'fixture-host', type: 'module' }, null, 2),
    'utf8',
  );

  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [fixtureRoot],
    providers: ['claude'],
    nodes: [makeSkillNode('.claude/skills/deploy/SKILL.md')],
    links: [],
    issues: [],
    stats: {
      filesWalked: 1,
      filesSkipped: 0,
      nodesCount: 1,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeSkillNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'claude',
    bodyHash: HASH,
    frontmatterHash: HASH,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function serverOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
  };
}

/** Write serve.json the way the `sm serve` verb does after bind. */
function publishServeInfo(handle: IServerHandle, overrides?: { scopeRoot?: string; host?: string }): void {
  writeServeInfo(
    defaultServeInfoPath(fixtureRoot),
    buildServeInfo({
      host: overrides?.host ?? handle.address.host,
      port: handle.address.port,
      pid: process.pid,
      scopeRoot: overrides?.scopeRoot ?? fixtureRoot,
      smVersion: '0.0.0-test',
      token: handle.activityToken,
    }),
  );
}

/**
 * Spawn the bridge the way a provider runtime does (payload on stdin)
 * and await its exit. MUST be async (`spawn`, not `spawnSync`): the
 * server under test runs in THIS process, and a sync spawn would block
 * the event loop the server needs to answer the bridge's POST, a
 * deadlock production never has (server and hook are separate
 * processes).
 */
function runBridge(): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [ACTIVITY_BRIDGE_REL, 'claude'], {
      cwd: fixtureRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('error', (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(killer);
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(SKILL_PAYLOAD));
  });
}

async function withServer<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(serverOptions(), {
    runtimeContext: { cwd: fixtureRoot },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
    rmSync(defaultServeInfoPath(fixtureRoot), { force: true });
  }
}

describe('activity bridge, end to end', () => {
  it('forwards a real Skill payload and the node.activity event reaches /ws', async () => {
    await withServer(async (handle) => {
      publishServeInfo(handle);

      const ws = new WebSocket(`ws://127.0.0.1:${handle.address.port}/ws`);
      const received = new Promise<Record<string, unknown>>((resolve, reject) => {
        ws.on('message', (frame) => resolve(JSON.parse(String(frame)) as Record<string, unknown>));
        ws.on('error', reject);
      });
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });

      try {
        const run = await runBridge();
        // Invisibility invariants: exit 0, EMPTY stdout.
        assert.equal(run.status, 0);
        assert.equal(run.stdout, '');
        assert.equal(run.stderr, '');

        const event = await received;
        assert.equal(event['type'], 'node.activity');
        assert.deepEqual(event['data'], {
          nodePath: '.claude/skills/deploy/SKILL.md',
          phase: 'start',
          owner: 'main',
        });
      } finally {
        ws.close();
      }
    });
  });

  it('no serve.json (server not running): silent no-op', async () => {
    rmSync(defaultServeInfoPath(fixtureRoot), { force: true });
    const run = await runBridge();
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, '');
  });

  it('scopeRoot mismatch: silent no-op, nothing broadcast', async () => {
    await withServer(async (handle) => {
      publishServeInfo(handle, { scopeRoot: '/some/other/project' });

      const ws = new WebSocket(`ws://127.0.0.1:${handle.address.port}/ws`);
      let broadcasts = 0;
      ws.on('message', () => {
        broadcasts += 1;
      });
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });

      try {
        const run = await runBridge();
        assert.equal(run.status, 0);
        assert.equal(run.stdout, '');
        assert.equal(run.stderr, '');
        // Give a would-be broadcast a beat to arrive before asserting.
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(broadcasts, 0);
      } finally {
        ws.close();
      }
    });
  });

  it('non-loopback host in serve.json (tampering): silent no-op', async () => {
    await withServer(async (handle) => {
      publishServeInfo(handle, { host: 'evil.example.com' });
      const run = await runBridge();
      assert.equal(run.status, 0);
      assert.equal(run.stdout, '');
      assert.equal(run.stderr, '');
    });
  });

  it('stale serve.json (server died): exit 0, empty stdout, at most one warn line', async () => {
    // Publish against a live server, then kill it, leaving the file.
    const handle = await createServer(serverOptions(), {
      runtimeContext: { cwd: fixtureRoot },
    });
    publishServeInfo(handle);
    await handle.close();
    try {
      const run = await runBridge();
      assert.equal(run.status, 0);
      assert.equal(run.stdout, '');
      const warnLines = run.stderr.split('\n').filter((line) => line.length > 0);
      assert.ok(warnLines.length <= 1, `expected at most one warn line, got: ${run.stderr}`);
    } finally {
      rmSync(defaultServeInfoPath(fixtureRoot), { force: true });
    }
  });
});
