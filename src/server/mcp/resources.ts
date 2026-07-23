/**
 * The read-only MCP resources (see `spec/mcp-server.md` §Resources).
 *
 * Resources are coarse and few by design: one graph resource, one issues
 * resource, one activity resource, plus a per-node template. The server
 * MUST NOT register one static resource per node (a large corpus would
 * flood the resource list), so the node template's `list` callback is
 * explicitly `undefined`, per-node reads go through the template or the
 * `get_node` tool.
 *
 *   - `skillmap://graph`       → full persisted `ScanResult` (`scans.load()`).
 *   - `skillmap://issues`      → full issue list (`{ items, total }`).
 *   - `skillmap://activity`    → live execution-stats snapshot
 *                                (`{ since, nodes, pairs }`, in-memory).
 *   - `skillmap://node/{+path}`→ one node's detail bundle (same as `get_node`).
 *
 * mimeType is `application/json` for every resource.
 */

import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import type { ScanResult } from '../../kernel/index.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import type { ActivityStatsService } from '../activity-stats.js';
import { emptyScanResult } from '../empty-scan.js';
import {
  ACTIVITY_RESOURCE_URI,
  GRAPH_RESOURCE_URI,
  ISSUES_RESOURCE_URI,
  NODE_RESOURCE_TEMPLATE,
  type IMcpReadContext,
} from './context.js';
import { getNode } from './tools.js';

/** Full persisted `ScanResult`; DB absent → the shared empty shape. */
export async function readGraphResource(ctx: IMcpReadContext): Promise<ScanResult> {
  const scan = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    (adapter) => adapter.scans.load(),
  );
  return scan ?? emptyScanResult();
}

export interface IIssuesResourceValue {
  items: unknown[];
  total: number;
}

/** Full issue list (`{ items, total }`); DB absent → empty. */
export async function readIssuesResource(ctx: IMcpReadContext): Promise<IIssuesResourceValue> {
  const items = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    (adapter) => adapter.issues.listAll(),
  );
  const list = items ?? [];
  return { items: list, total: list.length };
}

export interface IActivityResourceValue {
  since: number;
  nodes: unknown;
  pairs: unknown;
}

/**
 * Live execution-stats snapshot, the `GET /api/activity/summary` shape.
 * In-memory, resets each serve boot; no DB read.
 */
export function readActivityResource(stats: ActivityStatsService): IActivityResourceValue {
  return {
    since: stats.sinceMs,
    nodes: stats.snapshot(),
    pairs: stats.pairSnapshot(),
  };
}

/**
 * Register the three static resources + the per-node template on an
 * `McpServer`. Every read callback serialises its value as a single
 * `application/json` content block keyed by the requested URI.
 */
export function registerMcpResources(
  server: McpServer,
  ctx: IMcpReadContext,
  stats: ActivityStatsService,
): void {
  server.registerResource(
    'graph',
    GRAPH_RESOURCE_URI,
    {
      title: 'skill-map graph',
      description: 'The full persisted ScanResult (nodes, links, issues, stats).',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri.href, await readGraphResource(ctx)),
  );

  server.registerResource(
    'issues',
    ISSUES_RESOURCE_URI,
    {
      title: 'skill-map issues',
      description: 'The full issue list ({ items, total }).',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri.href, await readIssuesResource(ctx)),
  );

  server.registerResource(
    'activity',
    ACTIVITY_RESOURCE_URI,
    {
      title: 'skill-map live activity',
      description: 'A snapshot of live execution stats ({ since, nodes, pairs }). In-memory, resets each serve boot.',
      mimeType: 'application/json',
    },
    (uri) => jsonResource(uri.href, readActivityResource(stats)),
  );

  server.registerResource(
    'node',
    // `list: undefined` is REQUIRED (and deliberate): the template never
    // enumerates per-node resources, so a large corpus cannot flood the
    // resource list. Reads still resolve through the template.
    new ResourceTemplate(NODE_RESOURCE_TEMPLATE, { list: undefined }),
    {
      title: 'skill-map node',
      description: 'One node detail bundle ({ item, links, issues }); {path} is the node path.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const path = firstVariable(variables['path']);
      return jsonResource(uri.href, await getNode(ctx, { path }));
    },
  );
}

/** Serialise a value into a single `application/json` resource content block. */
function jsonResource(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

/**
 * Normalise a URI-template variable to a single string. `{+path}` yields
 * a plain string, but the SDK's `Variables` type is
 * `string | string[]`; an array (exploded form) collapses on `/`.
 */
function firstVariable(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('/');
  return value ?? '';
}
