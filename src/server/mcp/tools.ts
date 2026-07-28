/**
 * The four read-only MCP tools (see `spec/mcp-server.md` §Tools).
 *
 * Every tool is a pure read that wraps the exact kernel reads the REST
 * routes use, no new query capability:
 *
 *   - `query_graph`  → `applyExportQuery` over `scans.load()` (shared
 *                      `sm export` grammar: `kind=` / `has=` / `path=`).
 *   - `get_node`     → `scans.findNode(path)` (+ on-demand `readNodeBody`).
 *   - `list_issues`  → `issues.list(filter)` (same SQL-side filter /
 *                      pagination as `GET /api/issues`).
 *   - `get_branch`   → `scans.loadBranch(prefixes, cap)` (the `/api/branch`
 *                      prefix-union projection).
 *
 * Input schemas are Zod raw shapes because `McpServer.registerTool`'s
 * `inputSchema` is Zod-typed in `@modelcontextprotocol/sdk@1.29.0`
 * (`AnySchema = z3.ZodTypeAny | z4.$ZodType`; a plain JSON schema is
 * rejected by the SDK's `getZodSchemaObject`). Declaring the schema is
 * also what the spec mandates ("All tool inputs are validated against
 * the declared `inputSchema`") and what makes the SDK pass typed,
 * validated args to the callback. This is the SDK's official API, not a
 * BFF choice to add a validator: the REST surface keeps using the
 * in-house AJV `parse-body` factory.
 *
 * The executors are exported un-wrapped (returning the raw structured
 * result) so unit tests can assert their shapes without booting an MCP
 * transport; `registerMcpTools` wraps each into a `CallToolResult`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  applyExportQuery,
  ExportQueryError,
  parseExportQuery,
  type Issue,
  type Link,
  type Node,
} from '../../kernel/index.js';
import type { IExportQuery } from '../../kernel/index.js';
import type { IIssueListFilter, IIssueListResult } from '../../kernel/types/storage.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { resolveBranchScope } from '../util/branch-scope.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../limits.js';
import { readNodeBody } from '../node-body.js';
import type { IMcpReadContext } from './context.js';

/**
 * Design default for the render cap when the DB is absent (no
 * `scan_meta` to read). Mirrors `scan.maxNodes` and the `/api/branch`
 * fallback (`DEFAULT_MAX_RENDER_NODES` in `routes/branch.ts`).
 */
const DEFAULT_MAX_RENDER_NODES = 256;

/** Default node budget for `query_graph` (spec §Tools). */
const DEFAULT_QUERY_GRAPH_LIMIT = 100;

// ---------------------------------------------------------------------------
// query_graph
// ---------------------------------------------------------------------------

export const queryGraphInputShape = {
  kind: z
    .string()
    .optional()
    .describe('Node-kind whitelist, comma-separated (`sm export` `kind=` grammar), e.g. "skill,agent".'),
  has: z
    .string()
    .optional()
    .describe('Presence filter (`sm export` `has=` grammar). Today only "issues".'),
  path: z
    .string()
    .optional()
    .describe('POSIX glob over node.path (`sm export` `path=` grammar), e.g. ".claude/agents/**".'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max nodes to return (default 100, capped at the scan\'s maxRenderNodes).'),
};

export interface IQueryGraphArgs {
  kind?: string | undefined;
  has?: string | undefined;
  path?: string | undefined;
  limit?: number | undefined;
}

export interface IQueryGraphResult {
  nodes: Node[];
  links: Link[];
  issues: Issue[];
}

/**
 * Closed subgraph for a filter query. Reuses the `sm export` grammar via
 * `parseExportQuery` so a query means the same thing here, in `sm export`,
 * and on `GET /api/nodes`. The subset is closed by `applyExportQuery`
 * (links survive iff both endpoints survive; issues survive iff any node
 * survives); the `limit` slice then re-closes links / issues against the
 * kept node set.
 */
export async function queryGraph(
  ctx: IMcpReadContext,
  args: IQueryGraphArgs,
): Promise<IQueryGraphResult> {
  const query = buildExportQuery(args);

  const loaded = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    async (adapter) => {
      const [scan, maxRenderNodes] = await Promise.all([
        adapter.scans.load(),
        adapter.scans.effectiveMaxRenderNodes(),
      ]);
      return { scan, maxRenderNodes };
    },
  );

  const scan = loaded?.scan ?? { nodes: [], links: [], issues: [] };
  const maxRenderNodes = loaded?.maxRenderNodes ?? DEFAULT_MAX_RENDER_NODES;
  const cap = Math.min(Math.max(1, args.limit ?? DEFAULT_QUERY_GRAPH_LIMIT), maxRenderNodes);

  const subset = applyExportQuery(scan, query);
  const nodes = subset.nodes.slice(0, cap);
  const kept = new Set(nodes.map((n) => n.path));
  const links = subset.links.filter((l) => kept.has(l.source) && kept.has(l.target));
  const issues = subset.issues.filter((i) => i.nodeIds.some((id) => kept.has(id)));
  return { nodes, links, issues };
}

/**
 * Assemble an `IExportQuery` from the tool args by rebuilding the raw
 * `sm export` query string and re-parsing it, so the grammar + its
 * validation live in exactly one place (`parseExportQuery`). A malformed
 * value surfaces as JSON-RPC `-32602` (invalid params).
 */
function buildExportQuery(args: IQueryGraphArgs): IExportQuery {
  const tokens: string[] = [];
  for (const [key, value] of [
    ['kind', args.kind],
    ['has', args.has],
    ['path', args.path],
  ] as const) {
    if (value !== undefined && value.length > 0) tokens.push(`${key}=${value}`);
  }
  try {
    return parseExportQuery(tokens.join(' '));
  } catch (err) {
    if (err instanceof ExportQueryError) {
      throw new McpError(ErrorCode.InvalidParams, err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// get_node
// ---------------------------------------------------------------------------

export const getNodeInputShape = {
  path: z.string().describe('Scope-relative node path (its stable id), e.g. ".claude/agents/foo.md".'),
  includeBody: z
    .boolean()
    .optional()
    .describe('When true, read the file body on demand into `item.body` (`null` if unreadable).'),
};

export interface IGetNodeArgs {
  path: string;
  includeBody?: boolean | undefined;
}

export interface IGetNodeResult {
  item: Node & { body?: string | null };
  links: { incoming: Link[]; outgoing: Link[] };
  issues: Issue[];
}

/**
 * Single-node detail bundle. `scans.findNode` returns `null` for an
 * unknown path (or an absent DB); either way the spec maps it to a
 * JSON-RPC `-32602` invalid-params error. `includeBody` opts into a
 * filesystem re-read (`readNodeBody`), which refuses any path escaping
 * the scope root and returns `null` when the file is missing / unreadable.
 */
export async function getNode(ctx: IMcpReadContext, args: IGetNodeArgs): Promise<IGetNodeResult> {
  const bundle = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    (adapter) => adapter.scans.findNode(args.path),
  );
  if (!bundle) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown node path: ${args.path}`);
  }
  const item: Node & { body?: string | null } =
    args.includeBody === true
      ? { ...bundle.node, body: await readNodeBody(ctx.cwd, args.path) }
      : bundle.node;
  return {
    item,
    links: { incoming: bundle.linksIn, outgoing: bundle.linksOut },
    issues: bundle.issues,
  };
}

// ---------------------------------------------------------------------------
// list_issues
// ---------------------------------------------------------------------------

export const listIssuesInputShape = {
  severity: z
    .string()
    .optional()
    .describe('Severity whitelist, comma-separated (`error` / `warn` / `info`). Unknown values match nothing.'),
  analyzerId: z
    .string()
    .optional()
    .describe('Analyzer-id whitelist, comma-separated. A bare suffix (no `/`) matches the id after `<plugin>/`.'),
  node: z.string().optional().describe('Keep only issues whose `nodeIds` include this node path.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Page size (default 100, capped at 1000).'),
  offset: z.number().int().nonnegative().optional()
.describe('Page offset (default 0).'),
};

export interface IListIssuesArgs {
  severity?: string | undefined;
  analyzerId?: string | undefined;
  node?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Paginated, filtered issue list. Pushes the filter + pagination into
 * SQL via `issues.list` (identical to `GET /api/issues`); `total` is the
 * pre-pagination match count. An absent DB degrades to `{ items: [],
 * total: 0 }`.
 */
export async function listIssues(
  ctx: IMcpReadContext,
  args: IListIssuesArgs,
): Promise<IIssueListResult> {
  const filter: IIssueListFilter = {
    severities: splitCsv(args.severity),
    analyzerIds: splitCsv(args.analyzerId),
    nodePath: args.node ?? null,
    offset: Math.max(0, args.offset ?? 0),
    limit: Math.min(Math.max(1, args.limit ?? DEFAULT_LIMIT), MAX_LIMIT),
  };
  const result = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    (adapter) => adapter.issues.list(filter),
  );
  return result ?? { items: [], total: 0 };
}

// ---------------------------------------------------------------------------
// get_branch
// ---------------------------------------------------------------------------

export const getBranchInputShape = {
  path: z
    .array(z.string())
    .describe('Include overrides: forward-slash folder prefixes whose subtrees are visible (map scope overrides, nearest ancestor wins). Empty with no excludes = whole corpus; a bare list keeps its historical meaning (only those subtrees). ORDER is significant: with the root excluded and 2+ includes, the node cap fills by list order (earlier entries claim their nodes first).'),
  exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude overrides: subtrees hidden from the branch unless a deeper include rescues part of them.'),
  excludeRoot: z
    .boolean()
    .optional()
    .describe('The root override. Absent = inferred: excluded iff any include has no strict ancestor among the excludes.'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Node cap; can only LOWER the scan\'s maxRenderNodes, never raise it.'),
};

export interface IGetBranchArgs {
  path: string[];
  exclude?: string[] | undefined;
  excludeRoot?: boolean | undefined;
  limit?: number | undefined;
}

export interface IGetBranchResult {
  branch: {
    paths: string[];
    excluded: string[];
    rootExcluded: boolean;
    total: number;
    rendered: number;
    truncated: boolean;
    cap: number;
  };
  nodes: Node[];
  links: Link[];
  issues: Issue[];
}

/**
 * Override-scoped branch projection, the `/api/branch` shape
 * (`spec/cli-contract.md` §Map scope overrides). Scoping + capping
 * happen in SQL (`scans.loadBranch`) so a large corpus never hydrates
 * into memory. `limit` clamps to `[1, maxRenderNodes]` (only lowers the
 * scan's recorded cap). An absent DB → empty branch. A path in both
 * `path` and `exclude` is invalid params (same conflict the route
 * rejects with 400).
 */
export async function getBranch(
  ctx: IMcpReadContext,
  args: IGetBranchArgs,
): Promise<IGetBranchResult> {
  const resolved = resolveBranchScope({
    include: args.path,
    exclude: args.exclude ?? [],
    excludeRoot: args.excludeRoot,
  });
  if (!resolved.ok) {
    throw new McpError(
      ErrorCode.InvalidParams,
      tx(SERVER_TEXTS.branchConflictingPath, { path: resolved.conflictPath }),
    );
  }
  const scope = resolved.scope;
  const loaded = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    async (adapter) => {
      const maxRenderNodes = await adapter.scans.effectiveMaxRenderNodes();
      const cap =
        args.limit === undefined
          ? maxRenderNodes
          : Math.min(Math.max(1, args.limit), maxRenderNodes);
      const branch = await adapter.scans.loadBranch(scope, cap);
      return { branch, cap };
    },
  );

  if (loaded === null) {
    return {
      branch: {
        paths: scope.include,
        excluded: scope.exclude,
        rootExcluded: scope.rootExcluded,
        total: 0,
        rendered: 0,
        truncated: false,
        cap: DEFAULT_MAX_RENDER_NODES,
      },
      nodes: [],
      links: [],
      issues: [],
    };
  }

  const { branch, cap } = loaded;
  return {
    branch: {
      paths: branch.paths,
      excluded: scope.exclude,
      rootExcluded: scope.rootExcluded,
      total: branch.total,
      rendered: branch.nodes.length,
      truncated: branch.total > cap,
      cap,
    },
    nodes: branch.nodes,
    links: branch.links,
    issues: branch.issues,
  };
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Register the four read-only tools on an `McpServer`. Each callback
 * runs the executor and wraps the structured result into a
 * `CallToolResult` (JSON structured content + a text mirror, mimeType
 * `application/json`). Executor throws (`McpError`) surface to the client
 * as JSON-RPC errors; the SDK converts unexpected throws into a
 * tool-error result.
 */
export function registerMcpTools(server: McpServer, ctx: IMcpReadContext): void {
  server.registerTool(
    'query_graph',
    {
      title: 'Query the skill / agent / command graph',
      description:
        'Return a closed subgraph { nodes, links, issues } for a filter query (kind / has / path), bounded by limit.',
      inputSchema: queryGraphInputShape,
    },
    async (args) => toToolResult(await queryGraph(ctx, args)),
  );

  server.registerTool(
    'get_node',
    {
      title: 'Get one node detail bundle',
      description:
        'Return a single node { item, links: { incoming, outgoing }, issues }. includeBody reads the file body on demand.',
      inputSchema: getNodeInputShape,
    },
    async (args) => toToolResult(await getNode(ctx, args)),
  );

  server.registerTool(
    'list_issues',
    {
      title: 'List scan issues',
      description:
        'Return { items, total } of persisted issues, filtered by severity / analyzerId / node and paginated.',
      inputSchema: listIssuesInputShape,
    },
    async (args) => toToolResult(await listIssues(ctx, args)),
  );

  server.registerTool(
    'get_branch',
    {
      title: 'Get a folder-prefix branch projection',
      description:
        'Return { branch, nodes, links, issues } for the union of one or more folder prefixes (the map projection).',
      inputSchema: getBranchInputShape,
    },
    async (args) => toToolResult(await getBranch(ctx, args)),
  );
}

/**
 * Wrap a structured result into a `CallToolResult`: the JSON object rides
 * `structuredContent` (the machine-readable channel) and a pretty-printed
 * text mirror rides `content` (for clients that only render text). No
 * `outputSchema` is declared, so the SDK passes both through unvalidated.
 */
function toToolResult(data: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/**
 * Split a comma-separated filter value into trimmed, non-empty tokens.
 * Mirrors `parseCsv` in `server/util/parse-query.ts` so the MCP + REST
 * issue filters share "what counts as a value".
 */
function splitCsv(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
