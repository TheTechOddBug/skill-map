/**
 * Built-in deterministic `node-set-tags` Action.
 *
 * Per-node Action the user invokes to set the taxonomy tags of the
 * current node (`annotations.tags`, an array of strings). Conceptually
 * parallel to `nodeBumpAction` / `nodeSupersedeAction`: the Action
 * stays pure (no IO inside `invoke()`), computes a sidecar write
 * payload (`TActionWrite { kind: 'sidecar', ... }`) that sets
 * `annotations.tags` on the current node and stamps the audit block,
 * and returns it for the kernel to materialise through `ISidecarStore`
 * after the call returns.
 *
 * Whole-array replace: the prompt the `core/tags` analyzer projects
 * pre-loads the current tags, so an edit (add / remove / modify) is just
 * the new full array written back over the old one. There is no
 * per-element merge.
 *
 * The companion `core/tags` analyzer projects the inspector button that
 * dispatches this Action.
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
 * Input parameters accepted by `node-set-tags`.
 *
 *   - `tags`, the full taxonomy array to write into the current node's
 *     `annotations.tags`. Whole-array replace, not a merge.
 */
export interface INodeSetTagsInput {
  tags: string[];
}

/**
 * Report shape returned by the deterministic `invoke`. Parallels the
 * `node-bump` / `node-supersede` in-process reports (`ok` + payload),
 * distinct from the probabilistic-record contract in
 * `report.schema.json`.
 *
 *   - success: `{ ok: true, tags }`.
 */
export interface INodeSetTagsReport {
  ok: boolean;
  tags?: string[];
}

const ID = 'node-set-tags';

export const nodeSetTagsAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Sets the taxonomy tags of the current node (writes `tags` to the sidecar; whole-array replace).',
  mode: 'deterministic',

  // The runtime contract uses generic <TInput, TReport>; this narrows
  // both. The cast is the standard pattern for built-ins that want
  // typed local I/O while staying compatible with the open generic.
  invoke<TInput, TReport>(
    rawInput: TInput,
    ctx: IActionContext,
  ): IActionResult<TReport> {
    const input = (rawInput ?? {}) as INodeSetTagsInput;
    return invokeSetTags(input, ctx) as IActionResult<TReport>;
  },
};

function invokeSetTags(
  input: INodeSetTagsInput,
  ctx: IActionContext,
): IActionResult<INodeSetTagsReport> {
  const tags = Array.isArray(input.tags) ? input.tags : [];

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
      annotations: { tags },
      audit: {
        lastBumpedAt: timestamp,
        lastBumpedBy: ctx.invoker,
      },
    },
  };

  const report: INodeSetTagsReport = { ok: true, tags };
  return { report, writes: [write] };
}
