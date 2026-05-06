/**
 * Built-in deterministic `bump` Action (Step 9.6.3, Decision #125).
 *
 * Increments the sidecar's `annotations.version`, refreshes the `for`
 * hashes against the live node, and stamps the `audit` block. The
 * Action stays pure — no IO inside `invoke()`. It returns a sidecar
 * write payload (`TActionWrite { kind: 'sidecar', ... }`) that the
 * kernel materialises through `ISidecarStore` after the call returns.
 *
 * Behaviour matrix (Decision #1):
 *
 *   - Stale node (or no sidecar yet) → bump. Increment version, refresh
 *     hashes, populate `audit.lastBumpedAt` + `lastBumpedBy`. On
 *     first-time creation also populate `audit.createdAt` +
 *     `audit.createdBy`.
 *   - Fresh node, `force !== true` → refuse. Return
 *     `{ ok: false, reason: 'fresh' }`, no `writes`. The CLI surfaces a
 *     human-readable error in 9.6.4; tests assert on the report shape.
 *   - Fresh node, `force === true` → silent no-op (intended for batch
 *     invocations like `sm bump --pending --staged`). Return
 *     `{ ok: true, noop: true }`, no `writes`.
 *
 * The Action consumes the existing `Node.sidecar` overlay produced by
 * the 9.6.2 reader to decide stale-vs-fresh. The kernel populates that
 * overlay during the scan that precedes the bump invocation; tests
 * stub it directly.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
  TActionWrite,
} from '../../../kernel/extensions/index.js';
import { sidecarPathFor } from '../../../kernel/sidecar/parse.js';

/**
 * Input parameters accepted by `bump`.
 *
 *   - `force` — when `true`, a fresh-node bump becomes a silent no-op
 *     instead of a refusal. Used by batch flows (`sm bump --pending
 *     --staged`) that legitimately want "do nothing if not stale".
 *   - `reason` — optional free-form note written into
 *     `audit.bumpReason`.
 */
export interface IBumpInput {
  force?: boolean;
  reason?: string;
}

/**
 * Report shape mirroring `bump-report.schema.json`.
 */
export interface IBumpReport {
  ok: boolean;
  noop?: boolean;
  reason?: 'fresh';
  version?: number;
  createdSidecar?: boolean;
}

const ID = 'bump';
const PLUGIN_ID = 'core';

export const bumpAction: IAction = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  version: '1.0.0',
  description:
    'Increments the sidecar `annotations.version`, refreshes the identity hashes, and stamps the audit block. Refuses on a fresh (non-stale) node unless `force: true` is passed.',
  stability: 'stable',
  mode: 'deterministic',
  reportSchemaRef: 'https://skill-map.dev/spec/v0/bump-report.schema.json',

  // The runtime contract uses generic <TInput, TReport>; bump narrows
  // both. The cast is the standard pattern for built-ins that want
  // typed local I/O while staying compatible with the open generic.
  invoke<TInput, TReport>(
    rawInput: TInput,
    ctx: IActionContext,
  ): IActionResult<TReport> {
    const input = (rawInput ?? {}) as IBumpInput;
    return invokeBump(input, ctx) as IActionResult<TReport>;
  },
};

function invokeBump(
  input: IBumpInput,
  ctx: IActionContext,
): IActionResult<IBumpReport> {
  const overlay = ctx.node.sidecar ?? null;
  const isFresh = overlay?.present === true && overlay.status === 'fresh';

  if (isFresh) {
    return input.force === true
      ? { report: { ok: true, noop: true } }
      : { report: { ok: false, reason: 'fresh' } };
  }

  const sidecarExists = overlay?.present === true;
  const newVersion = pickCurrentVersion(overlay) + 1;
  const timestamp = ctx.now().toISOString();
  const changes = buildChanges(ctx, newVersion, timestamp, input.reason, sidecarExists);

  const write: TActionWrite = {
    kind: 'sidecar',
    path: sidecarPathFor(ctx.nodeAbsolutePath),
    changes,
  };

  const report: IBumpReport = { ok: true, version: newVersion };
  if (!sidecarExists) report.createdSidecar = true;
  return { report, writes: [write] };
}

function buildChanges(
  ctx: IActionContext,
  newVersion: number,
  timestamp: string,
  reason: string | undefined,
  sidecarExists: boolean,
): Record<string, unknown> {
  // `bumpReason` is always emitted: a string when the caller passed
  // one, `null` otherwise. The deep-merge in `FilesystemSidecarStore`
  // treats `null` as a delete sentinel, so an absent reason on the
  // current bump erases any reason left over from a prior bump (the
  // field is a per-bump note, never historical). The null never
  // survives to disk — schema validation runs after the merge and the
  // key is gone by then.
  const audit: Record<string, unknown> = {
    lastBumpedAt: timestamp,
    lastBumpedBy: ctx.invoker,
    bumpReason: reason ?? null,
  };
  if (!sidecarExists) {
    audit['createdAt'] = timestamp;
    audit['createdBy'] = ctx.invoker;
  }
  return {
    for: {
      path: ctx.node.path,
      bodyHash: ctx.node.bodyHash,
      frontmatterHash: ctx.node.frontmatterHash,
    },
    annotations: { version: newVersion },
    audit,
  };
}

/**
 * Pull the current `annotations.version` from the sidecar overlay.
 * Falls back to `0` (so the first bump produces `1`) when the overlay
 * is absent or carries no version.
 */
function pickCurrentVersion(
  overlay: { annotations?: Record<string, unknown> | null } | null,
): number {
  if (!overlay || !overlay.annotations) return 0;
  const v = (overlay.annotations as Record<string, unknown>)['version'];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
