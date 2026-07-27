/**
 * The MCP deterministic-issue suppression tools, siblings of the
 * findings lifecycle tools (`findings-tools.ts`). Registered whenever
 * the server is on (`mcp.server.enabled`). They mirror `sm issues
 * dismiss / undismiss` and the `POST /api/nodes/:pathB64/issues/*`
 * routes:
 *
 *   - `dismiss_issue`            -> standing `annotations.issueSuppressions`
 *                                   entry (consent-gated sidecar write) +
 *                                   delete of the covered `scan_issues`
 *                                   rows (emission-time semantics).
 *   - `undismiss_issue`          -> remove the matching entry
 *                                   (consent-gated); the issue reappears
 *                                   at the NEXT scan (rows were deleted
 *                                   at dismiss time, nothing to reveal).
 *   - `list_issue_suppressions`  -> READ over the write-through
 *                                   `scan_nodes.annotations_json` mirror.
 *
 * The two mutating tools take `confirm` / `always` params (the analog
 * of the BFF body flags): they succeed under a standing
 * `allowEditSmFiles` grant or with `confirm: true`, and refuse
 * otherwise with an `McpError` carrying
 * `details.key = 'allowEditSmFiles'`. The team policy
 * `allowSidecarWriters: false` is a HARD block, not bypassable by
 * `confirm`. Both open the DB with the WRITE posture and append one
 * operations-log line with `channel: 'mcp'`. The sidecar edit itself
 * goes through the shared `writeIssueSuppressions` (one writer with the
 * BFF routes, no third copy).
 */

import { resolve } from 'node:path';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  EConsentRequiredError,
  ESidecarWritersForbiddenError,
} from '../../core/config/sidecar-consent.js';
import { appendOperation } from '../../core/operations-log.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { Node } from '../../kernel/types.js';
import {
  buildIssueSuppressionEntry,
  existingIssueSuppressions,
  mergeIssueSuppression,
  readSidecarFor,
  removeIssueSuppression,
} from '../../kernel/sidecar/index.js';
import {
  issueSuppressionsFromAnnotations,
  type IIssueSuppressionEntry,
} from '../../kernel/util/issue-suppressions.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import {
  refreshAnnotationsMirror,
  writeIssueSuppressions,
} from '../util/issue-suppression-write.js';
import type { IMcpWriteContext } from './context.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Open the project DB with the WRITE posture (no `versionCheck`). A
 * missing DB surfaces as an invalid-params error; the consent errors
 * from a gated sidecar write are translated to `McpError` for the
 * client (mirror of `findings-tools.ts`).
 */
async function withWriteDb<T>(
  ctx: IMcpWriteContext,
  fn: (adapter: StoragePort) => Promise<T>,
): Promise<T> {
  let result: T | null;
  try {
    result = await tryWithSqlite({ databasePath: ctx.dbPath, autoBackup: false }, fn);
  } catch (err) {
    throw consentToMcp(err);
  }
  if (result === null) {
    throw new McpError(ErrorCode.InvalidParams, `Project database not found: ${ctx.dbPath}`);
  }
  return result;
}

/**
 * Translate the two sidecar-consent errors to `McpError`; anything else
 * rethrows untouched. A missing standing consent carries
 * `details.key = 'allowEditSmFiles'` (the agent answers by retrying
 * with `confirm` / `always`); the team policy denial is a hard block.
 */
function consentToMcp(err: unknown): unknown {
  if (err instanceof EConsentRequiredError) {
    return new McpError(
      ErrorCode.InvalidParams,
      `${err.message} (details.key = '${err.key}')`,
      { key: err.key },
    );
  }
  if (err instanceof ESidecarWritersForbiddenError) {
    return new McpError(ErrorCode.InvalidParams, err.message, { key: err.key });
  }
  return err;
}

/** Unknown-node refusal, the tool analog of the routes' 404. */
function nodeNotFound(node: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `No node with path "${node}".`);
}

// ---------------------------------------------------------------------------
// dismiss_issue
// ---------------------------------------------------------------------------

export const dismissIssueInputShape = {
  node: z.string().describe('Node path (its stable id).'),
  analyzer: z
    .string()
    .describe('Emitting analyzer id, stored VERBATIM (short or qualified; matching accepts both).'),
  value: z
    .string()
    .describe("The flagged token, the issue's data.target (exact, case-sensitive)."),
  note: z.string().optional().describe('Optional operator note stored with the suppression.'),
  confirm: z.boolean().optional().describe('One-shot consent for the sidecar write.'),
  always: z.boolean().optional().describe('Persist the standing consent (allowEditSmFiles).'),
};

export interface IDismissIssueArgs {
  node: string;
  analyzer: string;
  value: string;
  note?: string | undefined;
  confirm?: boolean | undefined;
  always?: boolean | undefined;
}

export type TDismissIssueResult = {
  outcome: 'suppressed' | 'already-suppressed';
  /** `scan_issues` rows deleted by the emission-time convergence. */
  deletedIssues: number;
};

/**
 * Write the standing `(analyzer, value)` suppression to the node's
 * `.sm` sidecar (consent) and DELETE the covered persisted `scan_issues`
 * rows so reads agree without a rescan. Idempotent: an equivalent
 * standing entry reports `already-suppressed` (no duplicate is added);
 * the row delete still runs so a drifted DB converges. Unknown node ->
 * invalid-params `McpError` (the tool analog of the route's 404).
 */
export async function dismissIssue(
  ctx: IMcpWriteContext,
  args: IDismissIssueArgs,
): Promise<TDismissIssueResult> {
  return withWriteDb(ctx, async (adapter) => {
    const bundle = await adapter.scans.findNode(args.node);
    if (!bundle) throw nodeNotFound(args.node);
    let already = false;
    await writeIssueSuppressions(
      adapter,
      ctx,
      args.node,
      (entries) => {
        const merged = mergeIssueSuppression(
          entries,
          buildIssueSuppressionEntry(args.analyzer, args.value, args.note),
        );
        already = merged.length === entries.length;
        return merged;
      },
      { confirm: args.confirm, always: args.always },
    );
    const deletedIssues = await adapter.issues.deleteForSuppression(
      args.node,
      args.analyzer,
      args.value,
    );
    appendOperation(ctx.cwd, {
      op: 'issues.dismiss',
      target: args.node,
      channel: 'mcp',
      outcome: 'ok',
      detail: `analyzer=${args.analyzer} value=${args.value} rows=${deletedIssues}`,
    });
    return { outcome: already ? 'already-suppressed' : 'suppressed', deletedIssues };
  });
}

// ---------------------------------------------------------------------------
// undismiss_issue
// ---------------------------------------------------------------------------

export const undismissIssueInputShape = {
  node: z.string().describe('Node path (its stable id).'),
  analyzer: z
    .string()
    .describe('Analyzer id of the standing suppression (short or qualified; matching accepts both).'),
  value: z.string().describe('The suppressed token (exact, case-sensitive).'),
  confirm: z.boolean().optional().describe('One-shot consent for the sidecar write.'),
  always: z.boolean().optional().describe('Persist the standing consent (allowEditSmFiles).'),
};

export interface IUndismissIssueArgs {
  node: string;
  analyzer: string;
  value: string;
  confirm?: boolean | undefined;
  always?: boolean | undefined;
}

export type TUndismissIssueResult =
  | { outcome: 'unsuppressed'; removed: Record<string, unknown> }
  | { outcome: 'not-found' };

/**
 * Remove the matching `(analyzer, value)` entry from the node's sidecar
 * (consent) and refresh the mirror. `not-found` covers BOTH an unknown
 * node and a missing entry; the missing-entry branch self-heals the
 * mirror from the live `.sm` first (mirror of the BFF 409). The issue
 * itself reappears at the NEXT scan (dismiss deleted its rows).
 */
export async function undismissIssue(
  ctx: IMcpWriteContext,
  args: IUndismissIssueArgs,
): Promise<TUndismissIssueResult> {
  return withWriteDb(ctx, async (adapter) => {
    const bundle = await adapter.scans.findNode(args.node);
    if (!bundle) return { outcome: 'not-found' as const };
    const mdAbs = resolve(ctx.cwd, args.node);
    const entries = existingIssueSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
    const { removed } = removeIssueSuppression(entries, args.analyzer, args.value);
    if (removed === null) {
      await refreshAnnotationsMirror(adapter, ctx, args.node);
      return { outcome: 'not-found' as const };
    }
    await writeIssueSuppressions(
      adapter,
      ctx,
      args.node,
      (all) => removeIssueSuppression(all, args.analyzer, args.value).remaining,
      { confirm: args.confirm, always: args.always },
    );
    appendOperation(ctx.cwd, {
      op: 'issues.undismiss',
      target: args.node,
      channel: 'mcp',
      outcome: 'ok',
      detail: `analyzer=${args.analyzer} value=${args.value}`,
    });
    return { outcome: 'unsuppressed' as const, removed };
  });
}

// ---------------------------------------------------------------------------
// list_issue_suppressions (read)
// ---------------------------------------------------------------------------

export const listIssueSuppressionsInputShape = {
  node: z.string().optional().describe('Node path (its stable id); omit for the whole project.'),
};

export interface IListIssueSuppressionsArgs {
  node?: string | undefined;
}

export interface IListIssueSuppressionsResult {
  suppressions: Array<IIssueSuppressionEntry & { node: string }>;
}

/**
 * Project the standing issue suppressions from the write-through
 * `scan_nodes.annotations_json` mirror (the same surface the node
 * payload's annotations carry). Node-scoped or whole-project; read
 * posture (advisory drift check, mirror of `list_findings`). A missing
 * DB degrades to the empty list; an unknown `node` is invalid-params.
 */
export async function listIssueSuppressions(
  ctx: IMcpWriteContext,
  args: IListIssueSuppressionsArgs,
): Promise<IListIssueSuppressionsResult> {
  const suppressions = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    async (adapter) => {
      if (args.node !== undefined) {
        const bundle = await adapter.scans.findNode(args.node);
        if (!bundle) throw nodeNotFound(args.node);
        return projectNodeEntries(bundle.node);
      }
      const nodes = await adapter.scans.findNodes({});
      return nodes.flatMap(projectNodeEntries);
    },
  );
  return { suppressions: suppressions ?? [] };
}

/** One node's mirror entries, each stamped with the node path. */
function projectNodeEntries(node: Node): Array<IIssueSuppressionEntry & { node: string }> {
  return issueSuppressionsFromAnnotations(node.sidecar?.annotations).map((entry) => ({
    node: node.path,
    ...entry,
  }));
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/** Register the issue-suppression tools on an `McpServer`. */
export function registerMcpIssuesTools(server: McpServer, ctx: IMcpWriteContext): void {
  server.registerTool(
    'dismiss_issue',
    {
      title: 'Dismiss a deterministic issue',
      description:
        'Write a standing (analyzer, value) suppression to the node sidecar (consent) and delete the covered scan_issues rows. Returns { outcome, deletedIssues }.',
      inputSchema: dismissIssueInputShape,
    },
    async (args) => toToolResult(await dismissIssue(ctx, args)),
  );

  server.registerTool(
    'undismiss_issue',
    {
      title: 'Undismiss a deterministic issue',
      description:
        'Remove the matching (analyzer, value) suppression from the node sidecar (consent). The issue reappears at the next scan. Returns { outcome, removed? }.',
      inputSchema: undismissIssueInputShape,
    },
    async (args) => toToolResult(await undismissIssue(ctx, args)),
  );

  server.registerTool(
    'list_issue_suppressions',
    {
      title: 'List issue suppressions',
      description:
        'Return { suppressions } from the annotations mirror: pass node for one node, omit it for the WHOLE project.',
      inputSchema: listIssueSuppressionsInputShape,
    },
    async (args) => toToolResult(await listIssueSuppressions(ctx, args)),
  );
}

/** Wrap a structured result into a `CallToolResult` (JSON structured content + a text mirror). */
function toToolResult(data: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}
