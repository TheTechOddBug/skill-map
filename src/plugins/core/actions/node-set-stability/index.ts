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
 * Dual surface (mirrors `node-set-tags` / `node-supersede`):
 *   - `project(ctx)` (scan-time, read-only graph): self-projects the
 *     `inspector.action.button` that dispatches this Action, one per real
 *     (non-virtual) node whether or not it already has a sidecar (the write
 *     creates the `.sm` when absent). The enum-pick prompt's `defaultValue`
 *     pre-loads the node's effective stability. The button lives with the
 *     action that dispatches it, so a
 *     disabled action projects no button (the enabled gate is applied by
 *     `composeScanExtensions` before `runActionProjections`).
 *   - `invoke(input, ctx)` (on-demand executor): writes `annotations.stability`.
 *
 * The companion `core/node-stability` analyzer reads the resulting
 * `annotations.stability` and surfaces it as a chip (plus a `deprecated`
 * finding); it no longer projects the button.
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
  IActionProjectionContext,
  IActionResult,
  IBuiltInManifest,
  TActionWrite,
} from '../../../../kernel/extensions/index.js';
import type { Node } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { sidecarPathFor } from '../../../../kernel/sidecar/parse.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';
import { type TStability, STABILITY_VALUES, readEffectiveStability } from '../../stability.js';
import { NODE_SET_STABILITY_TEXTS } from './text.js';

export type { TStability };

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

// Inspector action button this action self-projects. Module-level const
// so the manifest `ui` map and the `project()` emit reference the SAME
// object (the orchestrator recovers the contribution id + slot by object
// identity). Emitted for every node that already has a sidecar; the
// prompt pre-loads the current stability as its `defaultValue`.
const setStabilityButton = {
  slot: 'inspector.action.button',
  priority: 15,
} satisfies IViewContribution;

export const nodeSetStabilityAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Sets the lifecycle stage of the current node (writes `stability` to the sidecar).',
  mode: 'deterministic',

  ui: { setStabilityButton },

  project(ctx: IActionProjectionContext): void {
    for (const node of ctx.nodes) {
      // Skip synthetic nodes (no file on disk to anchor a `.sm`). Every real
      // node gets the button whether or not it already has a sidecar; the
      // write creates the `.sm` when absent (gated by the write-consent flow).
      if (node.virtual === true) continue;
      emitSetStabilityButton(ctx, node);
    }
  },

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

function emitSetStabilityButton(ctx: IActionProjectionContext, node: Node): void {
  ctx.emitContribution(node.path, setStabilityButton, {
    actionId: 'core/node-set-stability',
    label: NODE_SET_STABILITY_TEXTS.setLabel,
    icon: 'pi-flag',
    enabled: true,
    prompt: {
      inputType: 'enum-pick',
      paramKey: 'stability',
      label: NODE_SET_STABILITY_TEXTS.promptLabel,
      options: [
        { value: 'experimental', label: NODE_SET_STABILITY_TEXTS.optionExperimental },
        { value: 'stable', label: NODE_SET_STABILITY_TEXTS.optionStable },
        { value: 'deprecated', label: NODE_SET_STABILITY_TEXTS.optionDeprecated },
      ],
      // Pre-load the node's current stage so the picker opens on the active
      // value; `stable` when nothing is set yet.
      defaultValue: readEffectiveStability(node) ?? 'stable',
    },
  });
}

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
