/**
 * Built-in deterministic `node-set-tags` Action.
 *
 * Per-node Action the user invokes to set the taxonomy tags of the
 * current node (`annotations.tags`, an array of strings). Conceptually
 * parallel to `nodeBumpAction` / `nodeSetStabilityAction`: the Action
 * stays pure (no IO inside `invoke()`), computes a sidecar write
 * payload (`TActionWrite { kind: 'sidecar', ... }`) that sets
 * `annotations.tags` on the current node and stamps the audit block,
 * and returns it for the kernel to materialise through `ISidecarStore`
 * after the call returns.
 *
 * Whole-array replace: the prompt this action's scan-time `project()`
 * emits pre-loads the current tags, so an edit (add / remove / modify) is
 * just the new full array written back over the old one. There is no
 * per-element merge.
 *
 * Dual surface:
 *   - `project(ctx)` (scan-time, deterministic, read-only graph): emits
 *     one `inspector.action.button` per real (non-virtual) node whether or
 *     not it already has a sidecar (the write creates the `.sm` when
 *     absent, gated by the write-consent flow). The `string-list` prompt's
 *     `defaultValue` pre-loads
 *     the node's current `annotations.tags` so the edit reads as
 *     add / remove / modify over the existing set. The button lives with
 *     the action that dispatches it (no separate projector analyzer).
 *   - `invoke(input, ctx)` (on-demand executor): writes
 *     `annotations.tags`, see below.
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
import { TAGS_TEXTS } from './text.js';

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
 * `node-bump` / `node-set-stability` in-process reports (`ok` + payload),
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

// Inspector action button this action self-projects. Module-level const
// so the manifest `ui` map and the `project()` emit reference the SAME
// object (the orchestrator recovers the contribution id + slot by object
// identity). Emitted for every node that already has a sidecar; the
// prompt pre-loads the current tags as its `defaultValue`.
const setTagsButton = {
  slot: 'inspector.action.button',
  priority: 15,
} satisfies IViewContribution;

export const nodeSetTagsAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Sets the taxonomy tags of the current node (writes `tags` to the sidecar; whole-array replace).',
  mode: 'deterministic',

  ui: { setTagsButton },

  project(ctx: IActionProjectionContext): void {
    for (const node of ctx.nodes) {
      // Skip synthetic nodes (no file on disk to anchor a `.sm`). Every real
      // node gets the button whether or not it already has a sidecar; the
      // write creates the `.sm` when absent (gated by the write-consent flow).
      if (node.virtual === true) continue;
      emitSetTagsButton(ctx, node);
    }
  },

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

function emitSetTagsButton(ctx: IActionProjectionContext, node: Node): void {
  ctx.emitContribution(node.path, setTagsButton, {
    actionId: 'core/node-set-tags',
    label: TAGS_TEXTS.editLabel,
    icon: 'pi-tags',
    enabled: true,
    prompt: {
      inputType: 'string-list',
      paramKey: 'tags',
      label: TAGS_TEXTS.promptLabel,
      defaultValue: currentTags(node),
    },
  });
}

/**
 * The node's current `annotations.tags` from its sidecar overlay, or
 * `[]` when absent / malformed. Drives the prompt's `defaultValue` so
 * the editor opens pre-loaded with the existing taxonomy.
 */
function currentTags(node: Node): string[] {
  const ann = node.sidecar?.annotations;
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) return [];
  const value = (ann as Record<string, unknown>)['tags'];
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}

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
