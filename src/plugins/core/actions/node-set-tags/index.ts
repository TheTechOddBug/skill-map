/**
 * Built-in deterministic `node-set-tags` Action.
 *
 * Per-node Action that sets the taxonomy tags of the current node
 * (`annotations.tags`, an array of strings). Conceptually parallel to
 * `nodeBumpAction` / `nodeSetStabilityAction`: the Action stays pure (no
 * IO inside `invoke()`), computes a sidecar write payload
 * (`TActionWrite { kind: 'sidecar', ... }`) that sets `annotations.tags`
 * on the current node and stamps the audit block, and returns it for the
 * kernel to materialise through `ISidecarStore` after the call returns.
 *
 * Whole-array replace: the caller passes the full new array (the inspector
 * editor pre-loads the current tags so an edit, add / remove / modify, is
 * just the new full array written back over the old one). There is no
 * per-element merge. The written array is sanitized first (strings only,
 * trimmed, no empties, deduped) so a free-form input never produces a
 * schema-violating sidecar.
 *
 * No self-projected button: unlike `node-set-stability` / `node-bump`,
 * this Action does NOT emit an `inspector.action.button`. Tag editing
 * lives inline in the inspector's tag row (`<sm-node-tags>`), which seeds
 * itself from the node's current tags and dispatches this Action by
 * qualified id (`core/node-set-tags`) on save. The Action therefore has
 * no `project()` / `ui` surface; it is purely an on-demand executor.
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

export const nodeSetTagsAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Sets the taxonomy tags of the current node (writes `tags` to the sidecar; whole-array replace).',
  mode: 'deterministic',
  // Declares the sidecar-write capability: `invoke()` returns a
  // `{ kind: 'sidecar' }` write, so the `allowSidecarWriters` policy can
  // gate this action without invoking it.
  writes: ['sidecar'],

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

/**
 * Sanitize the incoming tag array before it is written: keep strings only,
 * trim whitespace, drop empties (`annotations.schema.json` requires
 * `minLength: 1`), and dedup preserving first-seen order. The input is
 * free-form (UI inline editor, REST, CLI), so without this the action
 * could write a schema-violating or messy `annotations.tags`.
 */
function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim();
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function invokeSetTags(
  input: INodeSetTagsInput,
  ctx: IActionContext,
): IActionResult<INodeSetTagsReport> {
  const tags = sanitizeTags(input.tags);

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
