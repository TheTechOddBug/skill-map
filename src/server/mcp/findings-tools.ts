/**
 * The MCP findings read + lifecycle tools (see `spec/mcp-server.md`
 * §Findings lifecycle tools). Registered whenever the server is on
 * (`mcp.server.enabled`). They mirror `sm findings` and the `GET` /
 * `POST` / `DELETE /api/nodes/:pathB64/findings/*` routes:
 *
 *   - `list_findings`    -> `adapter.findings.list` (READ; node-scoped or
 *                           whole-project).
 *   - `resolve_finding`  -> `adapter.findings.resolveByHuman` (DB-only).
 *   - `dismiss_finding`  -> row grain (`dismissByHuman`, DB-only) or, with
 *                           `class: true`, a `.sm` sidecar suppression
 *                           (consent-gated).
 *   - `reopen_finding`   -> `adapter.findings.reopen` (DB-only).
 *   - `undismiss_finding`-> remove the matching sidecar suppression
 *                           (consent-gated).
 *   - `delete_finding`   -> `adapter.findings.removeById` (DB), plus the
 *                           orphan-suppression lift (consent) when deleting
 *                           the last dismissed row of a class.
 *
 * The two sidecar writers take `confirm` / `always` params (the analog of
 * the BFF body flags): they succeed under a standing `allowEditSmFiles`
 * grant or with `confirm: true`, and refuse otherwise with an `McpError`
 * carrying `details.key = 'allowEditSmFiles'`. The team policy
 * `allowSidecarWriters: false` is a HARD block (an `McpError`), not
 * bypassable by `confirm`. Every mutating tool opens the DB with the WRITE
 * posture and appends one operations-log line with `channel: 'mcp'`.
 */

import { resolve } from 'node:path';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  EConsentRequiredError,
  ESidecarWritersForbiddenError,
  ensureSidecarWritesAllowed,
} from '../../core/config/sidecar-consent.js';
import { appendOperation } from '../../core/operations-log.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { IFindingRecord, IFindingsListFilter } from '../../kernel/types/storage.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import {
  buildSuppressionEntry,
  existingSuppressions,
  mergeSuppression,
  normalizeSuppressionType,
  readSidecarFor,
  sidecarPathFor,
} from '../../kernel/sidecar/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { IMcpWriteContext } from './context.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Open the project DB with the WRITE posture (no `versionCheck`). A missing
 * DB surfaces as an invalid-params error; the consent errors from a gated
 * sidecar write are translated to `McpError` for the client.
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
 * `details.key = 'allowEditSmFiles'` (the UI / agent answers by retrying
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

/**
 * Apply an edit over the node's `annotations.suppressions` through the
 * gated channel and refresh the write-through mirror (mirror of the BFF
 * `writeSuppressions`). A brand-new (or invalid) sidecar sources its
 * required `identity` block from the live scan node. `EConsentRequiredError`
 * / `ESidecarWritersForbiddenError` propagate (caught + mapped by
 * `withWriteDb`).
 */
async function writeSuppressions(
  adapter: StoragePort,
  ctx: IMcpWriteContext,
  nodePath: string,
  edit: (entries: Record<string, unknown>[]) => Record<string, unknown>[],
  consent: { confirm?: boolean | undefined; always?: boolean | undefined },
): Promise<'ok' | 'node-gone'> {
  const mdAbs = resolve(ctx.cwd, nodePath);
  const read = readSidecarFor(mdAbs);
  const changes: Record<string, unknown> = {
    annotations: { suppressions: edit(existingSuppressions(read.parsed?.annotations)) },
  };
  if (read.parsed === null) {
    const bundle = await adapter.scans.findNode(nodePath);
    if (!bundle) return 'node-gone';
    changes['identity'] = {
      path: bundle.node.path,
      bodyHash: bundle.node.bodyHash,
      frontmatterHash: bundle.node.frontmatterHash,
    };
  }
  const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
  await store.applyPatch(sidecarPathFor(mdAbs), changes, {
    confirm: consent.confirm === true,
    always: consent.always === true,
    cwd: ctx.cwd,
  });
  await adapter.scans.refreshAnnotations(
    nodePath,
    readSidecarFor(mdAbs).parsed?.annotations ?? null,
  );
  return 'ok';
}

// ---------------------------------------------------------------------------
// list_findings (read)
// ---------------------------------------------------------------------------

export const listFindingsInputShape = {
  node: z.string().optional().describe('Node path (its stable id); omit for the whole project.'),
  extension: z
    .string()
    .optional()
    .describe('Qualified or bare extension id (e.g. core/ai-suspicion-analyzer).'),
  includeStale: z
    .boolean()
    .optional()
    .describe('Include stale rows (a finder judged an older body version). Default false.'),
};

export interface IListFindingsArgs {
  node?: string | undefined;
  extension?: string | undefined;
  includeStale?: boolean | undefined;
}

export interface IListFindingsResult {
  findings: IFindingRecord[];
}

/**
 * Read the probabilistic findings (`state_findings`) a finder recorded,
 * the counterpart the queue tools were missing: after `record_job`
 * completes, this is how the agent reads what the finder actually flagged
 * (the record outcome carries only the execution). Read posture (advisory
 * drift check, mirror of the map read tools). Wraps `adapter.findings.list`,
 * the same read `sm findings` / `GET /api/nodes/:pathB64/findings` use.
 */
export async function listFindings(
  ctx: IMcpWriteContext,
  args: IListFindingsArgs,
): Promise<IListFindingsResult> {
  const filter: IFindingsListFilter = { includeStale: args.includeStale === true };
  if (args.node !== undefined) filter.nodeId = args.node;
  if (args.extension !== undefined) filter.extensionIds = [args.extension];
  const findings = await tryWithSqlite(
    { databasePath: ctx.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    (adapter) => adapter.findings.list(filter),
  );
  return { findings: findings ?? [] };
}

// ---------------------------------------------------------------------------
// delete_finding
// ---------------------------------------------------------------------------

export const deleteFindingInputShape = {
  id: z.number().int().positive().describe('Finding row id to hard-delete.'),
  confirm: z
    .boolean()
    .optional()
    .describe('Consent for the sidecar write that only fires when deleting the LAST row of a dismissed class (orphan-suppression lift).'),
  always: z.boolean().optional().describe('Persist the sidecar-write consent (allowEditSmFiles).'),
};

export interface IDeleteFindingArgs {
  id: number;
  confirm?: boolean | undefined;
  always?: boolean | undefined;
}

export type TDeleteFindingResult = { outcome: 'deleted' | 'not-found' };

/**
 * Hard-delete one finding row (mirror of `DELETE
 * /api/nodes/:pathB64/findings/:id`). Pure DB EXCEPT the orphan-suppression
 * lift: deleting the LAST row of a dismissed class also removes its
 * now-orphan `(extension, type)` suppression from the sidecar (consent),
 * so the class does not come back HIDDEN when a later finder re-finds it.
 * The lift runs BEFORE the delete, so a missing consent aborts (McpError)
 * before any row is removed. The node is resolved from the finding itself.
 */
export async function deleteFinding(
  ctx: IMcpWriteContext,
  args: IDeleteFindingArgs,
): Promise<TDeleteFindingResult> {
  return withWriteDb(ctx, async (adapter) => {
    const finding = await adapter.findings.get(args.id);
    if (finding === null) return { outcome: 'not-found' };
    await liftOrphanSuppression(adapter, ctx, finding, {
      confirm: args.confirm,
      always: args.always,
    });
    const removed = await adapter.findings.removeById(args.id);
    if (removed !== true) return { outcome: 'not-found' };
    appendOperation(ctx.cwd, {
      op: 'findings.delete',
      target: finding.nodeId,
      extension: finding.extensionId,
      channel: 'mcp',
      outcome: 'ok',
      detail: `id=${args.id}`,
    });
    return { outcome: 'deleted' };
  });
}

/**
 * Remove the finding's now-orphan `(extension, type)` suppression from the
 * sidecar when this is the LAST row of that dismissed class (mirror of the
 * BFF `liftOrphanSuppression`). No-op when there is no matching suppression
 * or a sibling row of the same class survives; the sidecar write goes
 * through the consent gate (`EConsentRequiredError` propagates to
 * `withWriteDb`).
 */
async function liftOrphanSuppression(
  adapter: StoragePort,
  ctx: IMcpWriteContext,
  finding: IFindingRecord,
  consent: { confirm?: boolean | undefined; always?: boolean | undefined },
): Promise<void> {
  const mdAbs = resolve(ctx.cwd, finding.nodeId);
  const entries = existingSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
  const isTarget = (e: Record<string, unknown>): boolean =>
    e['extension'] === finding.extensionId &&
    normalizeSuppressionType(e['type']) === finding.type;
  if (!entries.some(isTarget)) return;
  const rows = await adapter.findings.list({ nodeId: finding.nodeId, includeStale: true });
  const hasSibling = rows.some(
    (f) => f.id !== finding.id && f.extensionId === finding.extensionId && f.type === finding.type,
  );
  if (hasSibling) return;
  await writeSuppressions(adapter, ctx, finding.nodeId, (all) => all.filter((e) => !isTarget(e)), consent);
}

// ---------------------------------------------------------------------------
// resolve_finding
// ---------------------------------------------------------------------------

export const resolveFindingInputShape = {
  id: z.number().int().positive().describe('Finding row id.'),
  note: z.string().optional().describe('Optional operator note stored with the resolution.'),
};

export interface IResolveFindingArgs {
  id: number;
  note?: string | undefined;
}

export type TResolveFindingResult = { outcome: 'resolved' | 'already-fixed' | 'not-found' };

/** Mark a finding `fixed` by the operator (DB-only, no consent). */
export async function resolveFinding(
  ctx: IMcpWriteContext,
  args: IResolveFindingArgs,
): Promise<TResolveFindingResult> {
  return withWriteDb(ctx, async (adapter) => {
    const outcome = await adapter.findings.resolveByHuman(args.id, args.note ?? null, Date.now());
    if (outcome.kind === 'resolved') {
      appendOperation(ctx.cwd, {
        op: 'findings.resolve',
        target: outcome.finding.nodeId,
        channel: 'mcp',
        outcome: 'ok',
        detail: `id=${args.id}`,
      });
    }
    return { outcome: outcome.kind };
  });
}

// ---------------------------------------------------------------------------
// dismiss_finding
// ---------------------------------------------------------------------------

export const dismissFindingInputShape = {
  id: z.number().int().positive().describe('Finding row id.'),
  class: z.boolean().optional().describe('When true, write the DURABLE class suppression to the sidecar (consent-gated).'),
  confirm: z.boolean().optional().describe('One-shot consent for the sidecar write (class only).'),
  always: z.boolean().optional().describe('Persist the standing consent (class only).'),
  note: z.string().optional().describe('Optional note.'),
};

export interface IDismissFindingArgs {
  id: number;
  class?: boolean | undefined;
  confirm?: boolean | undefined;
  always?: boolean | undefined;
  note?: string | undefined;
}

export type TDismissFindingResult = {
  outcome: 'dismissed' | 'already-dismissed' | 'suppressed' | 'not-found';
};

/**
 * Row-grain dismissal (DB-only) by default, or, with `class: true`, the
 * durable class suppression written to the node's `.sm` sidecar (consent).
 * Kernel safety-lane rows are not dismissible in either mode.
 */
export async function dismissFinding(
  ctx: IMcpWriteContext,
  args: IDismissFindingArgs,
): Promise<TDismissFindingResult> {
  return withWriteDb(ctx, async (adapter) => {
    const finding = await adapter.findings.get(args.id);
    if (!finding) return { outcome: 'not-found' };
    if (finding.origin === 'kernel') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Finding ${args.id} is a kernel safety-lane row and cannot be dismissed.`,
      );
    }
    if (args.class !== true) {
      const rowOutcome = await adapter.findings.dismissByHuman(args.id, args.note ?? null, Date.now());
      if (rowOutcome.kind === 'not-found') return { outcome: 'not-found' };
      if (rowOutcome.kind === 'already-dismissed') return { outcome: 'already-dismissed' };
      appendOperation(ctx.cwd, {
        op: 'findings.dismiss',
        target: finding.nodeId,
        channel: 'mcp',
        outcome: 'ok',
        detail: `id=${args.id} row`,
      });
      return { outcome: 'dismissed' };
    }
    const wrote = await writeSuppressions(
      adapter,
      ctx,
      finding.nodeId,
      (entries) =>
        mergeSuppression(entries, buildSuppressionEntry(finding.extensionId, finding.type, args.note)),
      { confirm: args.confirm, always: args.always },
    );
    if (wrote === 'node-gone') return { outcome: 'not-found' };
    appendOperation(ctx.cwd, {
      op: 'findings.dismiss',
      target: finding.nodeId,
      channel: 'mcp',
      outcome: 'ok',
      detail: `id=${args.id} class`,
    });
    return { outcome: 'suppressed' };
  });
}

// ---------------------------------------------------------------------------
// reopen_finding
// ---------------------------------------------------------------------------

export const reopenFindingInputShape = {
  id: z.number().int().positive().describe('Finding row id.'),
};

export interface IReopenFindingArgs {
  id: number;
}

export type TReopenFindingResult = { outcome: 'reopened' | 'already-open' | 'not-found' };

/** Clear ANY resolution back to open (DB-only). Does NOT lift a class suppression. */
export async function reopenFinding(
  ctx: IMcpWriteContext,
  args: IReopenFindingArgs,
): Promise<TReopenFindingResult> {
  return withWriteDb(ctx, async (adapter) => {
    const outcome = await adapter.findings.reopen(args.id, Date.now());
    if (outcome.kind === 'reopened') {
      appendOperation(ctx.cwd, {
        op: 'findings.reopen',
        target: outcome.finding.nodeId,
        channel: 'mcp',
        outcome: 'ok',
        detail: `id=${args.id}`,
      });
    }
    return { outcome: outcome.kind };
  });
}

// ---------------------------------------------------------------------------
// undismiss_finding
// ---------------------------------------------------------------------------

export const undismissFindingInputShape = {
  node: z.string().describe('Node path (its stable id).'),
  extension: z.string().describe('Qualified extension id of the suppressed class.'),
  type: z.string().optional().describe('Finding type of the suppressed class (absent = the blanket entry).'),
  confirm: z.boolean().optional().describe('One-shot consent for the sidecar write.'),
  always: z.boolean().optional().describe('Persist the standing consent.'),
};

export interface IUndismissFindingArgs {
  node: string;
  extension: string;
  type?: string | undefined;
  confirm?: boolean | undefined;
  always?: boolean | undefined;
}

export type TUndismissFindingResult = { outcome: 'unsuppressed' | 'no-match' | 'not-found' };

/** Remove the matching `(extension, type)` suppression from the node's sidecar (consent). */
export async function undismissFinding(
  ctx: IMcpWriteContext,
  args: IUndismissFindingArgs,
): Promise<TUndismissFindingResult> {
  return withWriteDb(ctx, async (adapter) => {
    const bundle = await adapter.scans.findNode(args.node);
    if (!bundle) return { outcome: 'not-found' };
    const mdAbs = resolve(ctx.cwd, args.node);
    const entries = existingSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
    const isTarget = (e: Record<string, unknown>): boolean =>
      e['extension'] === args.extension && normalizeSuppressionType(e['type']) === args.type;
    if (!entries.some(isTarget)) {
      // Self-heal the mirror before reporting no-match (same rule as the
      // CLI verb / BFF route).
      await adapter.scans.refreshAnnotations(
        args.node,
        readSidecarFor(mdAbs).parsed?.annotations ?? null,
      );
      return { outcome: 'no-match' };
    }
    const wrote = await writeSuppressions(
      adapter,
      ctx,
      args.node,
      (all) => all.filter((e) => !isTarget(e)),
      { confirm: args.confirm, always: args.always },
    );
    if (wrote === 'node-gone') return { outcome: 'not-found' };
    appendOperation(ctx.cwd, {
      op: 'findings.undismiss',
      target: args.node,
      extension: args.extension,
      channel: 'mcp',
      outcome: 'ok',
    });
    return { outcome: 'unsuppressed' };
  });
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/** Register the findings read + lifecycle tools on an `McpServer`. */
export function registerMcpFindingsTools(server: McpServer, ctx: IMcpWriteContext): void {
  server.registerTool(
    'list_findings',
    {
      title: 'List findings',
      description:
        'Return { findings } from state_findings: pass node for one node, omit it for the WHOLE project; optional extension + includeStale filters. This is how you read what a finder recorded after record_job.',
      inputSchema: listFindingsInputShape,
    },
    async (args) => toToolResult(await listFindings(ctx, args)),
  );

  server.registerTool(
    'resolve_finding',
    {
      title: 'Resolve a finding',
      description: 'Mark a finding fixed by the operator (DB-only). Returns { outcome }.',
      inputSchema: resolveFindingInputShape,
    },
    async (args) => toToolResult(await resolveFinding(ctx, args)),
  );

  server.registerTool(
    'dismiss_finding',
    {
      title: 'Dismiss a finding',
      description: 'Row-grain dismissal (DB-only), or class suppression to the sidecar with class: true (consent). Returns { outcome }.',
      inputSchema: dismissFindingInputShape,
    },
    async (args) => toToolResult(await dismissFinding(ctx, args)),
  );

  server.registerTool(
    'reopen_finding',
    {
      title: 'Reopen a finding',
      description: 'Clear any resolution back to open (DB-only). Returns { outcome }.',
      inputSchema: reopenFindingInputShape,
    },
    async (args) => toToolResult(await reopenFinding(ctx, args)),
  );

  server.registerTool(
    'undismiss_finding',
    {
      title: 'Undismiss a class',
      description: 'Remove the matching class suppression from the sidecar (consent). Returns { outcome }.',
      inputSchema: undismissFindingInputShape,
    },
    async (args) => toToolResult(await undismissFinding(ctx, args)),
  );

  server.registerTool(
    'delete_finding',
    {
      title: 'Delete a finding',
      description: 'Hard-delete one finding row by id. Pure DB, except it lifts an orphan class suppression from the sidecar (consent) when deleting the last dismissed row of a class. Returns { outcome }.',
      inputSchema: deleteFindingInputShape,
    },
    async (args) => toToolResult(await deleteFinding(ctx, args)),
  );
}

/** Wrap a structured result into a `CallToolResult` (JSON structured content + a text mirror). */
function toToolResult(data: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}
