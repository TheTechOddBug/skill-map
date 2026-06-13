/**
 * Built-in deterministic `node-supersede` Action.
 *
 * Per-node Action the user invokes to *declare* that the current node
 * is superseded by another. The companion `core/node-superseded`
 * analyzer reads the resulting `supersededBy` field and surfaces it as
 * an `info` issue, while `core/supersede` projects the inspector button
 * that dispatches this Action.
 *
 * Conceptually parallel to `nodeBumpAction`: the Action stays pure (no
 * IO inside `invoke()`), computes a sidecar write payload
 * (`TActionWrite { kind: 'sidecar', ... }`) that sets
 * `annotations.supersededBy` on the current node and stamps the audit
 * block, and returns it for the kernel to materialise through
 * `ISidecarStore` after the call returns.
 *
 * Behaviour:
 *
 *   - Self-supersede (`input.supersededBy === ctx.node.path`) -> refuse.
 *     Return `{ ok: false, reason: 'self' }`, no `writes`. The BFF maps
 *     the refusal to a `self`-coded envelope; tests assert on the shape.
 *   - Otherwise -> write. Deep-merge `annotations.supersededBy`, refresh
 *     the identity hashes, and stamp `audit.lastBumpedAt` /
 *     `lastBumpedBy`. Return `{ ok: true, supersededBy }` + the write.
 *
 * The Action does NOT validate that `input.supersededBy` exists in the
 * live node set: the Action context only sees the one node it operates
 * on, and a dangling target is caught downstream by
 * `core/reference-broken`.
 *
 * **NOT listed in `core/node-superseded.recommendedActions`**: when the
 * analyzer fires, the user already declared the supersession on
 * purpose; there is nothing to "fix". `node-supersede` is a *declarer*,
 * surfaced in the inspector via this action's OWN scan-time `project()`
 * self-projection (the button lives with the action that dispatches it,
 * not in a separate projector analyzer), not as a fix for the issue.
 *
 * Dual surface:
 *   - `project(ctx)` (scan-time, deterministic, read-only graph): emits
 *     one `inspector.action.button` per NON-virtual node. The button's
 *     `enum-pick` prompt offers the OTHER non-virtual nodes as targets
 *     (a node-picker over the live set, so only an existing node can be
 *     chosen and a node can never supersede itself). `enabled` is false
 *     when the node already carries a non-empty `annotations.supersededBy`
 *     (re-declaring is a no-op) OR when there is no other node to point
 *     at; the `disabledReason` tooltip says why. Virtual nodes are
 *     skipped entirely. Each button carries the full candidate list, so
 *     the persisted payload grows ~O(n^2) across the scan, fine for
 *     typical projects (tens of nodes); a very large scan should
 *     graduate to a lazy node-picker input-type that fetches candidates
 *     on demand.
 *   - `invoke(input, ctx)` (on-demand executor): writes
 *     `annotations.supersededBy`, see below.
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
import type { Node } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';
import { SUPERSEDE_TEXTS } from './text.js';

/**
 * Input parameters accepted by `node-supersede`.
 *
 *   - `supersededBy`, repo-relative path to the node that replaces the
 *     current one. The Action writes this verbatim into the current
 *     node's `annotations.supersededBy`.
 */
export interface INodeSupersedeInput {
  supersededBy: string;
}

/**
 * Report shape returned by the deterministic `invoke`. Parallels
 * `node-bump`'s in-process report (`ok` + payload), distinct from the
 * probabilistic-record contract in `report.schema.json`.
 *
 *   - refusal: `{ ok: false, reason: 'self' }`.
 *   - success: `{ ok: true, supersededBy }`.
 */
export interface INodeSupersedeReport {
  ok: boolean;
  reason?: 'self';
  supersededBy?: string;
}

const ID = 'node-supersede';

// Inspector action button this action self-projects. Module-level const
// so the manifest `ui` map and the `project()` emit reference the SAME
// object (the orchestrator recovers the contribution id + slot by object
// identity). Always emitted for non-virtual nodes; the payload's
// `enabled` flag carries the dynamic gate.
const supersedeButton = {
  slot: 'inspector.action.button',
  priority: 10,
} satisfies IViewContribution;

interface IPickOption {
  value: string;
  label: string;
}

export const nodeSupersedeAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Declares the current node as superseded by another (writes `supersededBy` to the sidecar).',
  // Ships disabled by default (the declarer feature is still settling its
  // node-picker UX). The button self-projection gates as a unit with the
  // invoke executor: an enabled button pointing at a disabled action
  // would error on click, so the whole action stays experimental.
  stability: 'experimental',
  mode: 'deterministic',

  ui: { supersedeButton },

  project(ctx: IActionProjectionContext): void {
    // Candidate targets: every non-virtual node. Built once from the live
    // node set so the picker only ever offers existing nodes (live-set
    // validation by construction).
    const candidates = ctx.nodes.filter((n) => n.virtual !== true).map((n) => n.path);
    for (const node of ctx.nodes) {
      if (node.virtual === true) continue;
      // Exclude the node itself: no self-supersede.
      const options: IPickOption[] = candidates
        .filter((p) => p !== node.path)
        .map((p) => ({ value: p, label: p }));
      emitSupersedeButton(ctx, node, options);
    }
  },

  // The runtime contract uses generic <TInput, TReport>; supersede
  // narrows both. The cast is the standard pattern for built-ins that
  // want typed local I/O while staying compatible with the open generic.
  invoke<TInput, TReport>(
    rawInput: TInput,
    ctx: IActionContext,
  ): IActionResult<TReport> {
    const input = (rawInput ?? {}) as INodeSupersedeInput;
    return invokeSupersede(input, ctx) as IActionResult<TReport>;
  },
};

function emitSupersedeButton(
  ctx: IActionProjectionContext,
  node: Node,
  options: IPickOption[],
): void {
  const disabledReason = resolveDisabledReason(node, options.length);
  ctx.emitContribution(node.path, supersedeButton, {
    actionId: 'core/node-supersede',
    label: SUPERSEDE_TEXTS.supersedeLabel,
    icon: 'pi-arrow-right-arrow-left',
    enabled: disabledReason === undefined,
    ...(disabledReason === undefined ? {} : { disabledReason }),
    prompt: {
      inputType: 'enum-pick',
      paramKey: 'supersededBy',
      label: SUPERSEDE_TEXTS.supersedePromptLabel,
      options,
    },
  });
}

/**
 * The disabled-reason for the supersede button, or `undefined` when the
 * button is enabled. Disabled when the node is already superseded
 * (re-declaring is a no-op) or when there is no other node to point at.
 */
function resolveDisabledReason(node: Node, optionCount: number): string | undefined {
  if (alreadySuperseded(node)) return SUPERSEDE_TEXTS.supersedeDisabledReason;
  if (optionCount === 0) return SUPERSEDE_TEXTS.supersedeNoTargetsReason;
  return undefined;
}

/**
 * Whether a node's sidecar overlay already carries a non-empty
 * `annotations.supersededBy`. Mirrors the read in `core/node-superseded`
 * so the enabled gate and the issue surface agree on what "already
 * superseded" means.
 */
function alreadySuperseded(node: Node): boolean {
  const sidecar = node.sidecar;
  if (!sidecar || sidecar.present !== true) return false;
  const ann = sidecar.annotations;
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) return false;
  const value = (ann as Record<string, unknown>)['supersededBy'];
  return typeof value === 'string' && value.length > 0;
}

function invokeSupersede(
  input: INodeSupersedeInput,
  ctx: IActionContext,
): IActionResult<INodeSupersedeReport> {
  const supersededBy = input.supersededBy;

  // Self-supersede is a no-op declaration ("A is superseded by A"); the
  // Action refuses rather than write a meaningless edge. The context
  // only sees this one node, so a dangling target is NOT validated here
  // (caught downstream by `core/reference-broken`).
  if (supersededBy === ctx.node.path) {
    return { report: { ok: false, reason: 'self' } };
  }

  const timestamp = ctx.now().toISOString();
  const write: TActionWrite = {
    kind: 'sidecar',
    path: sidecarPathFor(ctx.nodeAbsolutePath),
    changes: {
      identity: {
        path: ctx.node.path,
        bodyHash: ctx.node.bodyHash,
        frontmatterHash: ctx.node.frontmatterHash,
      },
      annotations: { supersededBy },
      audit: {
        lastBumpedAt: timestamp,
        lastBumpedBy: ctx.invoker,
      },
    },
  };

  const report: INodeSupersedeReport = { ok: true, supersededBy };
  return { report, writes: [write] };
}
