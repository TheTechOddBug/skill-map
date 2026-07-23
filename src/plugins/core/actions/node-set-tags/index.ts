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
 * Dual surface (mirrors `node-set-stability` / `node-bump`):
 *   - `project(ctx)` (scan-time, read-only graph): self-projects an
 *     `inspector.action.button` per real (non-virtual) node. The button
 *     is NOT rendered as a button: its PRESENCE is what gates the
 *     inspector's inline tag row (`<sm-node-tags>`, the re-homed
 *     affordance, same documented UI exception as the stability /
 *     version chips), so a disabled action removes the row entirely
 *     (the enabled gate is applied by `composeScanExtensions` before
 *     `runActionProjections`). The row seeds itself from the node's
 *     current tags and dispatches this Action by qualified id
 *     (`core/node-set-tags`) on save; no `prompt` block is projected
 *     because the row hosts its own inline editor.
 *   - `invoke(input, ctx)` (on-demand executor): writes `annotations.tags`.
 */

import type {
  IAction,
  IActionContext,
  IActionProjectionContext,
  IActionResult,
  IBuiltInManifest,
  TActionWrite,
} from '../../../../kernel/extensions/index.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { sidecarPathFor } from '../../../../kernel/sidecar/parse.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';
import { NODE_SET_TAGS_TEXTS } from './node-set-tags.texts.js';

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
// identity). The inspector re-homes it onto the inline tag row: the
// contribution's presence gates the row, mirroring the stability chip.
const editTagsButton = {
  slot: 'inspector.surface.tags',
  priority: 14,
} satisfies IViewContribution;

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

  ui: { editTagsButton },

  project(ctx: IActionProjectionContext): void {
    for (const node of ctx.nodes) {
      // Skip synthetic nodes (no file on disk to anchor a `.sm`). Every
      // real node gets the contribution whether or not it already has a
      // sidecar; the write creates the `.sm` when absent (gated by the
      // write-consent flow).
      if (node.virtual === true) continue;
      ctx.emitContribution(node.path, editTagsButton, {
        actionId: 'core/node-set-tags',
        label: NODE_SET_TAGS_TEXTS.editLabel,
        icon: 'pi-tags',
            enabled: true,
      });
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
