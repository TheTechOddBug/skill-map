/**
 * Built-in deterministic `node-bump` Action (Step 9.6.3, Decision #125).
 *
 * Increments the sidecar's `annotations.version`, refreshes the `for`
 * hashes against the live node, and stamps the `audit` block. The
 * Action stays pure, no IO inside `invoke()`. It returns a sidecar
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
 *
 * Dual surface:
 *   - `project(ctx)` (scan-time, deterministic, read-only graph): emits
 *     one `inspector.action.button` per node that already has a sidecar
 *     (`node.sidecar.present === true`). Nodes with no sidecar are
 *     skipped so the inspector never offers to scaffold a `.sm` (creation
 *     is CLI-only). The payload's `enabled` flag carries the dynamic gate
 *     (stale => enabled). The button lives with the action that
 *     dispatches it; the `core/annotation-stale` analyzer keeps emitting
 *     the stale footer chip / header badge + the drift issue, but no
 *     longer the button.
 *   - `invoke(input, ctx)` (on-demand executor): bumps the sidecar, see
 *     below.
 */

import type {
  IAction,
  IActionContext,
  IActionProjectionContext,
  IActionResult,
  IBuiltInManifest,
  TActionWrite,
} from '../../../../kernel/extensions/index.js';
import { sidecarPathFor } from '../../../../kernel/sidecar/parse.js';
import type { ISidecarOverlay, SidecarStatus } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';
import { BUMP_TEXTS } from './text.js';

/**
 * Input parameters accepted by `node-bump`.
 *
 *   - `force`, when `true`, a fresh-node bump becomes a silent no-op
 *     instead of a refusal. Used by batch flows (`sm bump --pending
 *     --staged`) that legitimately want "do nothing if not stale".
 */
export interface INodeBumpInput {
  force?: boolean;
}

/**
 * Report shape mirroring `bump-report.schema.json`.
 */
export interface INodeBumpReport {
  ok: boolean;
  noop?: boolean;
  reason?: 'fresh';
  version?: number;
  createdSidecar?: boolean;
}

const ID = 'node-bump';

// Inspector action button this action self-projects. Module-level const
// so the manifest `ui` map and the `project()` emit reference the SAME
// object (the orchestrator recovers the contribution id + slot by object
// identity). Emitted for every node that already has a sidecar; the
// payload's `enabled` flag carries the dynamic gate (stale => enabled).
const bumpButton = {
  slot: 'inspector.action.button',
  priority: 10,
} satisfies IViewContribution;

export const nodeBumpAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Marks a node as updated: bumps `annotations.version`, refreshes sidecar hashes, and records the timestamp.',
  mode: 'deterministic',

  ui: { bumpButton },

  project(ctx: IActionProjectionContext): void {
    for (const node of ctx.nodes) {
      // Present for every node that already has a sidecar, enabled only
      // when stale. Nodes with no sidecar are skipped so the inspector
      // never offers to scaffold a `.sm` (creation is CLI-only).
      if (node.sidecar?.present !== true) continue;
      emitBumpButton(ctx, node.path, staleStatus(node.sidecar) !== null);
    }
  },

  // The runtime contract uses generic <TInput, TReport>; bump narrows
  // both. The cast is the standard pattern for built-ins that want
  // typed local I/O while staying compatible with the open generic.
  invoke<TInput, TReport>(
    rawInput: TInput,
    ctx: IActionContext,
  ): IActionResult<TReport> {
    const input = (rawInput ?? {}) as INodeBumpInput;
    return invokeBump(input, ctx) as IActionResult<TReport>;
  },
};

function emitBumpButton(
  ctx: IActionProjectionContext,
  nodePath: string,
  enabled: boolean,
): void {
  ctx.emitContribution(nodePath, bumpButton, {
    actionId: 'core/node-bump',
    label: BUMP_TEXTS.bumpLabel,
    icon: 'pi-arrow-up-right',
    enabled,
    ...(enabled ? {} : { disabledReason: BUMP_TEXTS.bumpDisabledReason }),
  });
}

/**
 * Narrow a sidecar overlay to its stale status, or `null` when the node
 * has no sidecar / is fresh. Mirrors `core/annotation-stale`'s read so
 * the button's enabled gate and the analyzer's drift surfaces agree on
 * what "stale" means.
 */
function staleStatus(
  overlay: ISidecarOverlay | null | undefined,
): Exclude<SidecarStatus, 'fresh'> | null {
  const status = overlay?.status;
  if (status === undefined || status === null || status === 'fresh') return null;
  return status;
}

function invokeBump(
  input: INodeBumpInput,
  ctx: IActionContext,
): IActionResult<INodeBumpReport> {
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
  const changes = buildChanges(ctx, newVersion, timestamp, sidecarExists);

  const write: TActionWrite = {
    kind: 'sidecar',
    path: sidecarPathFor(ctx.nodeAbsolutePath),
    changes,
  };

  const report: INodeBumpReport = { ok: true, version: newVersion };
  if (!sidecarExists) report.createdSidecar = true;
  return { report, writes: [write] };
}

function buildChanges(
  ctx: IActionContext,
  newVersion: number,
  timestamp: string,
  sidecarExists: boolean,
): Record<string, unknown> {
  const audit: Record<string, unknown> = {
    lastBumpedAt: timestamp,
    lastBumpedBy: ctx.invoker,
  };
  if (!sidecarExists) {
    audit['createdAt'] = timestamp;
    audit['createdBy'] = ctx.invoker;
  }
  return {
    identity: {
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
