/**
 * Shared fixture for the Step 16 piece 1 endpoint suites
 * (`node-findings-endpoint`, `node-prob-extensions-endpoint`,
 * `node-jobs-endpoint`).
 *
 * Builds a temp project whose `.skill-map/plugins/` carries the SAME
 * probabilistic fixture plugins the CLI submit suites use
 * (`cli/commands/__tests__/fixtures/`: `prob-finder` with a
 * `claude/skill` precondition, `prob-fixer` declaring
 * `precondition.analyzerIds`, `prob-summarizer` without `analyzerIds`),
 * trusted in the primed DB, plus scanned nodes whose `bodyHash` matches
 * the REAL on-disk body (the submit-time drift verification recomputes
 * it). The processing skill install is optional so the gate suite can
 * exercise the 409.
 *
 * NOT a spec file: the test runner glob only picks `.spec.ts` names, so
 * this helper contributes no empty test run.
 */

import { grantTrust } from '../../../../kernel/config/plugin-trust-store.js';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { installAgentSkill } from '../../../../core/agent-skill/engine.js';
import { SqliteStorageAdapter } from '../../../../kernel/adapters/sqlite/index.js';
import { replaceFindingsForNode, type IFindingInsertRow } from '../../../../kernel/adapters/sqlite/findings.js';
import { sha256 } from '../../../../kernel/orchestrator/node-build.js';
import {
  createServer,
  type IBroadcasterClient,
  type IServerHandle,
  type IServerOptions,
} from '../../../index.js';

const CLI_FIXTURES = fileURLToPath(
  new URL('../../../../cli/commands/__tests__/fixtures/', import.meta.url),
);

/** Fixture plugin ids (drop-ins copied into the project). */
export const PROB_PLUGINS = ['prob-finder', 'prob-fixer', 'prob-summarizer'] as const;

export const FINDER_ID = 'prob-finder/quality-check';
export const FIXER_ID = 'prob-fixer/apply-fix';
export const SUMMARIZER_ID = 'prob-summarizer/skill-echo';

/** The canonical skill-node fixture (matches the fixture preconditions). */
export const SKILL_NODE = {
  path: '.claude/skills/foo/SKILL.md',
  kind: 'skill',
  provider: 'claude',
} as const;

export interface INodeSeed {
  path: string;
  kind: string;
  provider: string;
  virtual?: boolean;
  /**
   * Persisted frontmatter (default `{}`): the `frontmatterMissing`
   * precondition gate reads it, so a fixture asserting that gate seeds
   * a complete `{ name, description }` pair here.
   */
  frontmatter?: Record<string, unknown>;
}

export interface IProbProject {
  root: string;
  dbPath: string;
}

/** The on-disk body the fixture writes for `path` (after the fence). */
export function bodyFor(path: string): string {
  return `Body of ${path}\n`;
}

/** The live `bodyHash` of a seeded non-virtual node. */
export function liveBodyHash(path: string): string {
  return sha256(bodyFor(path));
}

async function insertNode(adapter: SqliteStorageAdapter, node: INodeSeed): Promise<void> {
  await adapter.db
    .insertInto('scan_nodes')
    .values({
      path: node.path,
      kind: node.kind,
      provider: node.provider,
      title: null,
      description: null,
      stability: null,
      version: null,
      sidecarStatus: null,
      annotationsJson: null,
      sidecarRootJson: null,
      frontmatterJson: JSON.stringify(node.frontmatter ?? {}),
      // The REAL hash of the written body: the submit-time drift
      // verification recomputes it from disk and refuses on a mismatch.
      bodyHash: node.virtual ? 'b'.repeat(64) : liveBodyHash(node.path),
      frontmatterHash: 'f'.repeat(64),
      bytesFrontmatter: 0,
      bytesBody: 8,
      bytesTotal: 8,
      tokensFrontmatter: null,
      tokensBody: null,
      tokensTotal: null,
      externalRefsJson: null,
      scannedAt: Date.now(),
      modifiedAtMs: null,
      virtual: node.virtual ? 1 : 0,
      derivedFromJson: null,
    })
    .execute();
}

/**
 * Build a temp project under `parentDir`: copy the fixture plugins into
 * `.skill-map/plugins/`, init the project DB, insert + materialise the
 * given nodes, trust the plugins, and (optionally) install the
 * processing skill so the submit gate passes.
 */
export async function setupProbProject(
  parentDir: string,
  nodes: readonly INodeSeed[],
  opts: { installSkill: boolean },
): Promise<IProbProject> {
  const root = parentDir;
  const dbPath = join(root, '.skill-map', 'skill-map.db');
  mkdirSync(join(root, '.skill-map', 'plugins'), { recursive: true });
  for (const plugin of PROB_PLUGINS) {
    cpSync(join(CLI_FIXTURES, plugin), join(root, '.skill-map', 'plugins', plugin), {
      recursive: true,
    });
  }
  if (opts.installSkill) installAgentSkill(root, '.claude/skills');

  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const node of nodes) {
      await insertNode(adapter, node);
      if (!node.virtual) {
        const abs = join(root, node.path);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, `---\ntitle: t\n---\n${bodyFor(node.path)}`);
      }
    }
    for (const plugin of PROB_PLUGINS) {
      grantTrust(root, plugin);
    }
  } finally {
    await adapter.close();
  }
  return { root, dbPath };
}

/**
 * Seed `state_findings` rows for one `(nodeId, extensionId)` pair
 * (REPLACE semantics, mirroring the record path). Rows default to the
 * finder lane / warn / fresh (`bodyHashAtGeneration` = the node's live
 * hash); pass `bodyHashAtGeneration` explicitly to seed a STALE row.
 */
export async function seedFindings(
  project: IProbProject,
  nodeId: string,
  extensionId: string,
  rows: readonly Partial<IFindingInsertRow>[],
): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: project.dbPath, autoBackup: false });
  await adapter.init();
  try {
    const full: IFindingInsertRow[] = rows.map((row, i) => ({
      origin: 'extension',
      type: `finding-${i}`,
      severity: 'warn',
      message: `message ${i}`,
      detail: null,
      confidence: 0.9,
      extensionVersion: '1.0.0',
      model: null,
      bodyHashAtGeneration: liveBodyHash(nodeId),
      generatedAt: Date.now(),
      jobId: null,
      ...row,
    }));
    await replaceFindingsForNode(adapter.db, nodeId, extensionId, full);
  } finally {
    await adapter.close();
  }
}

/** One seedable `scan_issues` row (deterministic-analyzer issue). */
export interface IIssueSeed {
  /** Stored SHORT analyzer id (`issue.schema.json`: no slash). */
  analyzerId: string;
  /** The `data.target` value the issue flags (the suppression key). */
  target: string;
  nodeIds?: readonly string[];
  severity?: 'error' | 'warn' | 'info';
  message?: string;
}

/**
 * Seed `scan_issues` rows (the deterministic issues the per-issue
 * dismiss surfaces delete on suppression). Plain inserts, mirror of the
 * `state_findings` seeding above.
 */
export async function seedIssues(
  project: IProbProject,
  rows: readonly IIssueSeed[],
): Promise<void> {
  const adapter = new SqliteStorageAdapter({ databasePath: project.dbPath, autoBackup: false });
  await adapter.init();
  try {
    for (const row of rows) {
      await adapter.db
        .insertInto('scan_issues')
        .values({
          analyzerId: row.analyzerId,
          severity: row.severity ?? 'warn',
          nodeIdsJson: JSON.stringify(row.nodeIds ?? [SKILL_NODE.path]),
          linkIndicesJson: null,
          message: row.message ?? `broken reference ${row.target}`,
          detail: null,
          fixJson: null,
          dataJson: JSON.stringify({ target: row.target }),
        })
        .execute();
    }
  } finally {
    await adapter.close();
  }
}

/** Run `fn` against a fresh adapter over the project DB (open/close managed). */
export async function withProjectDb<T>(
  project: IProbProject,
  fn: (adapter: SqliteStorageAdapter) => Promise<T>,
): Promise<T> {
  const adapter = new SqliteStorageAdapter({ databasePath: project.dbPath, autoBackup: false });
  await adapter.init();
  try {
    return await fn(adapter);
  } finally {
    await adapter.close();
  }
}

export function probServerOptions(project: IProbProject): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: project.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    // Drop-in discovery ON: the fixture plugins are the classification
    // subjects of these suites.
    noPlugins: false,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
    settingsEnv: {},
  };
}

export async function bootAndUse<T>(
  project: IProbProject,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(probServerOptions(project), {
    runtimeContext: { cwd: project.root },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

export function serverUrl(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

export interface IFakeWsClient extends IBroadcasterClient {
  sent: string[];
}

export function makeFakeWsClient(): IFakeWsClient {
  const sent: string[] = [];
  return {
    sent,
    bufferedAmount: 0,
    readyState: 1,
    send(data: string): void {
      sent.push(data);
    },
    close(): void {
      /* no-op */
    },
  };
}

// Re-exported so the four spec files importing it from here keep
// working; the implementation lives in `envelope-validator.ts`, which
// registers every sibling schema instead of a hand-listed few.
export { compileEnvelopeValidator } from './envelope-validator.js';
