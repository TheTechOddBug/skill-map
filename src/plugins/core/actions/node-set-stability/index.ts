/**
 * Built-in deterministic `node-set-stability` Action.
 *
 * Per-node Action the user invokes to set the lifecycle stage of the
 * current node (`annotations.stability` ∈
 * {`experimental`, `stable`, `deprecated`}). Conceptually parallel to
 * `nodeBumpAction` / `nodeSupersedeAction`: the Action stays pure (no
 * IO inside `invoke()`), computes a sidecar write payload
 * (`TActionWrite { kind: 'sidecar', ... }`) that sets
 * `annotations.stability` on the current node and stamps the audit
 * block, and returns it for the kernel to materialise through
 * `ISidecarStore` after the call returns.
 *
 * The companion `core/node-stability` analyzer reads the resulting
 * `annotations.stability` and surfaces it (chip + issue), and projects
 * the inspector button that dispatches this Action.
 *
 * Behaviour:
 *
 *   - Out-of-enum value (`input.stability` not one of the three) ->
 *     refuse. Return `{ ok: false, reason: 'invalid' }`, no `writes`.
 *   - Otherwise -> write. Set `annotations.stability`, refresh the
 *     identity hashes, and stamp `audit.lastBumpedAt` / `lastBumpedBy`.
 *     Return `{ ok: true, stability }` + the write.
 *
 * The enum mirrors `spec/schemas/annotations.schema.json#/properties/stability`.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
  IBuiltInManifest,
  TActionWrite,
} from '../../../../kernel/extensions/index.js';
import { sidecarPathFor } from '../../../../kernel/sidecar/parse.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

/**
 * Recognised lifecycle stages, mirror of
 * `spec/schemas/annotations.schema.json#/properties/stability`.
 */
export type TStability = 'experimental' | 'stable' | 'deprecated';

const STABILITY_VALUES: readonly TStability[] = ['experimental', 'stable', 'deprecated'];

/**
 * Input parameters accepted by `node-set-stability`.
 *
 *   - `stability`, the lifecycle stage to write into the current node's
 *     `annotations.stability`. Validated against the closed enum; an
 *     out-of-enum value is refused (no write).
 */
export interface INodeSetStabilityInput {
  stability: TStability;
}

/**
 * Report shape returned by the deterministic `invoke`. Parallels the
 * `node-bump` / `node-supersede` in-process reports (`ok` + payload),
 * distinct from the probabilistic-record contract in
 * `report.schema.json`.
 *
 *   - refusal: `{ ok: false, reason: 'invalid' }`.
 *   - success: `{ ok: true, stability }`.
 */
export interface INodeSetStabilityReport {
  ok: boolean;
  reason?: 'invalid';
  stability?: TStability;
}

const ID = 'node-set-stability';

export const nodeSetStabilityAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Sets the lifecycle stage of the current node (writes `stability` to the sidecar).',
  mode: 'deterministic',

  // The runtime contract uses generic <TInput, TReport>; this narrows
  // both. The cast is the standard pattern for built-ins that want
  // typed local I/O while staying compatible with the open generic.
  invoke<TInput, TReport>(
    rawInput: TInput,
    ctx: IActionContext,
  ): IActionResult<TReport> {
    const input = (rawInput ?? {}) as INodeSetStabilityInput;
    return invokeSetStability(input, ctx) as IActionResult<TReport>;
  },
};

function invokeSetStability(
  input: INodeSetStabilityInput,
  ctx: IActionContext,
): IActionResult<INodeSetStabilityReport> {
  const stability = input.stability;

  // Reject anything outside the closed enum; the Action writes only a
  // recognised lifecycle stage.
  if (!STABILITY_VALUES.includes(stability)) {
    return { report: { ok: false, reason: 'invalid' } };
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
      annotations: { stability },
      audit: {
        lastBumpedAt: timestamp,
        lastBumpedBy: ctx.invoker,
      },
    },
  };

  const report: INodeSetStabilityReport = { ok: true, stability };
  return { report, writes: [write] };
}
