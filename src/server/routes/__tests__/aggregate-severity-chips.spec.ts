/**
 * Read-time fold of fresh open findings into `core/issue-counter`'s
 * aggregate severity chips on `card.footer.right`
 * (`spec/view-slots.md` §card.footer.right). Boots a real
 * `createServer()` against a primed DB and asserts the summed chip on
 * BOTH the list route (`GET /api/nodes`) and the single-node route
 * (`GET /api/nodes/:pathB64`).
 *
 * The DETERMINISTIC component is represented by seeding issue-counter's
 * persisted `warnCount` / `errorCount` contribution directly: issue-counter
 * runs at SCAN time and the BFF reads its persisted output, so the fold
 * never re-derives it from `scan_issues`. The FINDINGS component is seeded
 * straight into `state_findings` via `replaceFindingsForNode` (the same
 * write the record path uses).
 *
 * Cases:
 *   - issues only            -> chip value + tooltip unchanged.
 *   - issues + findings      -> summed value + provenance tooltip.
 *   - findings only          -> synthesized chip (no deterministic row).
 *   - neither                -> no aggregate chip.
 *   - both origins count     -> kernel-lane + finder-lane both summed.
 *   - fixed / human-decision / stale / info findings never count.
 *   - cap at 99.
 *   - non-issue-counter contributions pass through untouched.
 *   - the `nonce` record credential leaks in NO response body.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import {
  replaceFindingsForNode,
  type IFindingInsertRow,
} from '../../../kernel/adapters/sqlite/findings.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { IContributionRecord } from '../../../kernel/adapters/sqlite/contributions.js';
import type { Node, ScanResult } from '../../../kernel/types.js';
import { encodeNodePath } from '../../path-codec.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);
const HASH_DRIFTED = 'c'.repeat(64);
const FINDER_ID = 'test-finder/quality';

interface IWireContribution {
  pluginId: string;
  extensionId: string;
  contributionId: string;
  slot: string;
  payload: { value?: number; severity?: string; tooltip?: string };
}

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-agg-chips-'));
  root = { tmp, fixtureRoot: join(tmp, 'fixture'), dbPath: join(tmp, 'primed.db') };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(root.dbPath, { force: true });
  await primeFixture();
});

function makeNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'claude',
    bodyHash: HASH_BODY,
    frontmatterHash: HASH_FRONTMATTER,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

/** A persisted issue-counter chip (what issue-counter emits at scan time). */
function chip(
  nodePath: string,
  contributionId: 'warnCount' | 'errorCount',
  value: number,
  severity: 'warn' | 'danger',
  tooltip: string,
): IContributionRecord {
  return {
    pluginId: 'core',
    extensionId: 'issue-counter',
    nodePath,
    contributionId,
    slot: 'card.footer.right',
    payload: { value, severity, tooltip },
    emittedAt: Date.now(),
  };
}

const NODE_PATHS = [
  'issues-only.md',
  'both.md',
  'both-origins.md',
  'findings-only.md',
  'neither.md',
  'cap.md',
  // Single-state isolation nodes: each carries exactly one finding in one
  // resolution/staleness/severity state, no deterministic chip, so its
  // chip (or absence) proves that state's counting rule on its own.
  'human-only.md',
  'fixed-only.md',
  'stale-only.md',
  'info-only.md',
] as const;

async function primeFixture(): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: NODE_PATHS.map(makeNode),
    links: [],
    issues: [],
    stats: {
      filesWalked: NODE_PATHS.length,
      filesSkipped: 0,
      nodesCount: NODE_PATHS.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };

  const contributions: IContributionRecord[] = [
    // Deterministic chips (the scan-time component the BFF sums into).
    chip('issues-only.md', 'warnCount', 2, 'warn', 'SEEDED_WARN_TOOLTIP'),
    chip('both.md', 'warnCount', 2, 'warn', 'SEEDED_BOTH_TOOLTIP'),
    chip('both-origins.md', 'warnCount', 1, 'warn', 'SEEDED_ORIGINS_TOOLTIP'),
    chip('cap.md', 'errorCount', 95, 'danger', 'SEEDED_CAP_TOOLTIP'),
    // A non-issue-counter chip on the same slot: must pass through untouched.
    {
      pluginId: 'core',
      extensionId: 'external-url-counter',
      nodePath: 'both.md',
      contributionId: 'urls',
      slot: 'card.footer.right',
      payload: { value: 7 },
      emittedAt: Date.now(),
    },
  ];

  const adapter = new SqliteStorageAdapter({ databasePath: root.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result, { contributions });

    // both.md: 2 that COUNT (open + human-decision, both unresolved &
    // non-stale) + 3 that must NOT (fixed, stale, info).
    await seedFindings(adapter, 'both.md', [
      { type: 'open-warn', severity: 'warn' },
      { type: 'fixed-warn', severity: 'warn' },
      { type: 'human-warn', severity: 'warn' },
      { type: 'stale-warn', severity: 'warn', bodyHashAtGeneration: HASH_DRIFTED },
      { type: 'info-open', severity: 'info' },
    ]);
    await adapter.db
      .updateTable('state_findings')
      .set({ resolution: 'fixed', resolutionActor: 'human' })
      .where('nodeId', '=', 'both.md')
      .where('type', '=', 'fixed-warn')
      .execute();
    await adapter.db
      .updateTable('state_findings')
      .set({ resolution: 'human-decision' })
      .where('nodeId', '=', 'both.md')
      .where('type', '=', 'human-warn')
      .execute();

    // Single-state isolation nodes (no deterministic chip): the finding's
    // presence (human) or absence (fixed / stale / info) in the summed
    // chip proves that state's rule without any other row in the way.
    await seedFindings(adapter, 'human-only.md', [{ type: 'h', severity: 'warn' }]);
    await adapter.db
      .updateTable('state_findings')
      .set({ resolution: 'human-decision' })
      .where('nodeId', '=', 'human-only.md')
      .execute();
    await seedFindings(adapter, 'fixed-only.md', [{ type: 'f', severity: 'warn' }]);
    await adapter.db
      .updateTable('state_findings')
      .set({ resolution: 'fixed', resolutionActor: 'fixer' })
      .where('nodeId', '=', 'fixed-only.md')
      .execute();
    await seedFindings(adapter, 'stale-only.md', [
      { type: 's', severity: 'warn', bodyHashAtGeneration: HASH_DRIFTED },
    ]);
    await seedFindings(adapter, 'info-only.md', [{ type: 'i', severity: 'info' }]);

    // both-origins.md: one finder-lane + one kernel-lane open warn -> both count.
    await seedFindings(adapter, 'both-origins.md', [
      { type: 'ext-warn', severity: 'warn', origin: 'extension' },
      { type: 'kernel-warn', severity: 'warn', origin: 'kernel' },
    ]);

    // findings-only.md: one open error, no deterministic chip -> synthesized.
    await seedFindings(adapter, 'findings-only.md', [{ type: 'open-error', severity: 'error' }]);

    // cap.md: deterministic 95 + 10 open errors -> capped at 99.
    await seedFindings(
      adapter,
      'cap.md',
      Array.from({ length: 10 }, (_v, i) => ({ type: `err-${i}`, severity: 'error' as const })),
    );
  } finally {
    await adapter.close();
  }
}

async function seedFindings(
  adapter: SqliteStorageAdapter,
  nodeId: string,
  rows: readonly {
    type: string;
    severity: 'warn' | 'error' | 'info';
    bodyHashAtGeneration?: string;
    origin?: 'extension' | 'kernel';
  }[],
): Promise<void> {
  const full: IFindingInsertRow[] = rows.map((r, i) => ({
    origin: r.origin ?? 'extension',
    type: r.type,
    severity: r.severity,
    message: `message ${i}`,
    detail: null,
    confidence: 0.9,
    extensionVersion: '1.0.0',
    model: null,
    bodyHashAtGeneration: r.bodyHashAtGeneration ?? HASH_BODY,
    generatedAt: Date.now(),
    jobId: null,
  }));
  await replaceFindingsForNode(adapter.db, nodeId, FINDER_ID, full);
}

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
    settingsEnv: {},
  };
}

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: root.fixtureRoot },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

function issueCounterChip(
  contribs: readonly IWireContribution[],
  contributionId: 'warnCount' | 'errorCount',
): IWireContribution | undefined {
  return contribs.find(
    (c) =>
      c.pluginId === 'core' &&
      c.extensionId === 'issue-counter' &&
      c.contributionId === contributionId,
  );
}

async function listContributions(
  handle: IServerHandle,
  path: string,
): Promise<IWireContribution[]> {
  const res = await fetch(url(handle, '/api/nodes'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    items: Array<{ path: string; contributions: IWireContribution[] }>;
  };
  const node = body.items.find((n) => n.path === path);
  assert.ok(node, `node ${path} present in list`);
  return node.contributions;
}

async function singleContributions(
  handle: IServerHandle,
  path: string,
): Promise<IWireContribution[]> {
  const res = await fetch(url(handle, `/api/nodes/${encodeNodePath(path)}`));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { item: { contributions: IWireContribution[] } };
  return body.item.contributions;
}

describe('aggregate severity chips: read-time findings fold', () => {
  it('list: issues only -> chip value + tooltip unchanged', async () => {
    await bootAndUse(async (handle) => {
      const warn = issueCounterChip(await listContributions(handle, 'issues-only.md'), 'warnCount');
      assert.ok(warn);
      assert.equal(warn.payload.value, 2);
      assert.equal(warn.payload.tooltip, 'SEEDED_WARN_TOOLTIP');
    });
  });

  it('list: issues + findings -> summed value + provenance tooltip', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await listContributions(handle, 'both.md');
      const warn = issueCounterChip(contribs, 'warnCount');
      assert.ok(warn);
      // 2 deterministic + 2 counted findings (open + human-decision);
      // fixed / stale / info excluded.
      assert.equal(warn.payload.value, 4);
      assert.equal(warn.payload.severity, 'warn');
      assert.equal(warn.payload.tooltip, '4 warnings: 2 checks + 2 AI findings');
      // No error chip was seeded or synthesized on this node.
      assert.equal(issueCounterChip(contribs, 'errorCount'), undefined);
    });
  });

  it('list: both finding origins (finder-lane + kernel-lane) count', async () => {
    await bootAndUse(async (handle) => {
      const warn = issueCounterChip(
        await listContributions(handle, 'both-origins.md'),
        'warnCount',
      );
      assert.ok(warn);
      // 1 deterministic + 2 findings (one extension origin, one kernel origin).
      assert.equal(warn.payload.value, 3);
      assert.equal(warn.payload.tooltip, '3 warnings: 1 check + 2 AI findings');
    });
  });

  it('list: findings only -> synthesized chip under issue-counter id', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await listContributions(handle, 'findings-only.md');
      const err = issueCounterChip(contribs, 'errorCount');
      assert.ok(err, 'error chip synthesized from the finding');
      assert.equal(err.payload.value, 1);
      assert.equal(err.payload.severity, 'danger');
      assert.equal(err.slot, 'card.footer.right');
      assert.equal(err.payload.tooltip, '1 error: 0 checks + 1 AI finding');
      assert.equal(issueCounterChip(contribs, 'warnCount'), undefined);
    });
  });

  it('list: neither issues nor findings -> no aggregate chip', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await listContributions(handle, 'neither.md');
      assert.equal(issueCounterChip(contribs, 'warnCount'), undefined);
      assert.equal(issueCounterChip(contribs, 'errorCount'), undefined);
    });
  });

  it('list: summed value caps at 99', async () => {
    await bootAndUse(async (handle) => {
      const err = issueCounterChip(await listContributions(handle, 'cap.md'), 'errorCount');
      assert.ok(err);
      assert.equal(err.payload.value, 99);
      // The provenance breakdown stays truthful (uncapped) under the cap.
      assert.equal(err.payload.tooltip, '105 errors: 95 checks + 10 AI findings');
    });
  });

  it('list: non-issue-counter contributions pass through untouched', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await listContributions(handle, 'both.md');
      const urls = contribs.find(
        (c) => c.extensionId === 'external-url-counter' && c.contributionId === 'urls',
      );
      assert.ok(urls, 'the url counter survives the fold');
      assert.equal(urls.payload.value, 7);
      assert.equal(urls.payload.severity, undefined);
      assert.equal(urls.payload.tooltip, undefined);
    });
  });

  it('single: issues + findings -> summed value + provenance tooltip', async () => {
    await bootAndUse(async (handle) => {
      const warn = issueCounterChip(await singleContributions(handle, 'both.md'), 'warnCount');
      assert.ok(warn);
      assert.equal(warn.payload.value, 4);
      assert.equal(warn.payload.tooltip, '4 warnings: 2 checks + 2 AI findings');
    });
  });

  it('single: findings only -> synthesized chip', async () => {
    await bootAndUse(async (handle) => {
      const err = issueCounterChip(
        await singleContributions(handle, 'findings-only.md'),
        'errorCount',
      );
      assert.ok(err);
      assert.equal(err.payload.value, 1);
      assert.equal(err.payload.severity, 'danger');
    });
  });

  it('single: issues only -> chip unchanged', async () => {
    await bootAndUse(async (handle) => {
      const warn = issueCounterChip(
        await singleContributions(handle, 'issues-only.md'),
        'warnCount',
      );
      assert.ok(warn);
      assert.equal(warn.payload.value, 2);
      assert.equal(warn.payload.tooltip, 'SEEDED_WARN_TOOLTIP');
    });
  });

  it('single: neither -> no aggregate chip', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await singleContributions(handle, 'neither.md');
      assert.equal(issueCounterChip(contribs, 'warnCount'), undefined);
      assert.equal(issueCounterChip(contribs, 'errorCount'), undefined);
    });
  });

  it('human-decision COUNTS: a lone human-decision finding synthesizes the chip', async () => {
    // The fixer's proposal awaits the author, so it is an open problem on
    // the node and must count, matching the inspector's default view.
    await bootAndUse(async (handle) => {
      const warn = issueCounterChip(await listContributions(handle, 'human-only.md'), 'warnCount');
      assert.ok(warn, 'human-decision alone raises the chip');
      assert.equal(warn.payload.value, 1);
      assert.equal(warn.payload.tooltip, '1 warning: 0 checks + 1 AI finding');
    });
  });

  it('fixed does NOT count: a lone fixed finding leaves no chip', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await listContributions(handle, 'fixed-only.md');
      assert.equal(issueCounterChip(contribs, 'warnCount'), undefined);
      assert.equal(issueCounterChip(contribs, 'errorCount'), undefined);
    });
  });

  it('stale does NOT count: a lone stale finding leaves no chip', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await listContributions(handle, 'stale-only.md');
      assert.equal(issueCounterChip(contribs, 'warnCount'), undefined);
    });
  });

  it('info does NOT count: a lone info finding leaves no chip', async () => {
    await bootAndUse(async (handle) => {
      const contribs = await listContributions(handle, 'info-only.md');
      assert.equal(issueCounterChip(contribs, 'warnCount'), undefined);
      assert.equal(issueCounterChip(contribs, 'errorCount'), undefined);
    });
  });

  it('/api/scan cold-boot hydration folds findings into the chip too', async () => {
    // The SPA hydrates the corpus from /api/scan on F5; without the fold
    // there, a refreshed page would show the deterministic-only chip until
    // the first per-node fetch. Same summed value as the /api/nodes route.
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/scan'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        nodes: Array<{ path: string; contributions: IWireContribution[] }>;
      };
      const both = body.nodes.find((n) => n.path === 'both.md');
      assert.ok(both, 'both.md present in the scan snapshot');
      const warn = issueCounterChip(both.contributions, 'warnCount');
      assert.ok(warn, 'the scan snapshot carries the summed chip');
      assert.equal(warn.payload.value, 4);
      assert.equal(warn.payload.tooltip, '4 warnings: 2 checks + 2 AI findings');
      // A findings-only node gets its synthesized chip on cold boot too.
      const only = body.nodes.find((n) => n.path === 'findings-only.md');
      assert.ok(only);
      assert.equal(issueCounterChip(only.contributions, 'errorCount')?.payload.value, 1);
    });
  });

  it('no-leak: the `nonce` record credential appears in no response body', async () => {
    await bootAndUse(async (handle) => {
      const listRaw = await (await fetch(url(handle, '/api/nodes'))).text();
      assert.doesNotMatch(listRaw, /nonce/i);
      const singleRaw = await (
        await fetch(url(handle, `/api/nodes/${encodeNodePath('both.md')}`))
      ).text();
      assert.doesNotMatch(singleRaw, /nonce/i);
    });
  });
});
