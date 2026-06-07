/**
 * `supersede` analyzer. Emits NO issues; it only projects the inspector
 * action button that lets the operator declare the current node
 * superseded by another (dispatches `core/node-supersede`).
 *
 * The companion `core/node-superseded` analyzer surfaces the resulting
 * `supersededBy` declaration as an `info` issue; this analyzer is the
 * *declarer's* affordance, mirroring how `annotation-stale` projects
 * the `core/node-bump` button.
 *
 * Behaviour:
 *
 *   - For every NON-virtual node it emits one `inspector.action.button`
 *     contribution. The button is always present (the persistence upsert
 *     refreshes the row each scan); the payload's `enabled` flag carries
 *     the dynamic gate.
 *   - The prompt is an `enum-pick` whose `options` are the OTHER
 *     non-virtual nodes in the scan. Picking the target from the live
 *     node set (instead of a free-text path) gives a node-picker UX AND
 *     validates the target by construction: only an existing node can be
 *     chosen, so the action never writes a dangling `supersededBy`, and a
 *     node can never supersede itself (it is excluded from its own options).
 *   - `enabled` is `false` when the node already carries a non-empty
 *     `annotations.supersededBy` (re-declaring is a no-op) OR when there
 *     is no other node to point at. The `disabledReason` tooltip says why.
 *   - `node.virtual === true` nodes are skipped entirely.
 *
 * Scale note: every button carries the full candidate list, so the
 * persisted payload grows ~O(n^2) across the scan. Fine for typical
 * projects (tens of nodes); a very large scan should graduate to a
 * dedicated lazy "node-picker" input-type that fetches candidates on
 * demand instead of embedding them per button.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { SUPERSEDE_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'supersede';

// Inspector action button that dispatches `core/node-supersede`. Always
// emitted for non-virtual nodes; the payload's `enabled` flag carries
// the dynamic gate.
const supersedeButton = {
  slot: 'inspector.action.button',
  priority: 10,
} satisfies IViewContribution;

interface IPickOption {
  value: string;
  label: string;
}

export const supersedeAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Projects the inspector "Supersede" button (declares a node replaced by another).',
  mode: 'deterministic',

  ui: { supersedeButton },

  evaluate(ctx: IAnalyzerContext): Issue[] {
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
    // This analyzer surfaces no issues; the declaration itself is an
    // `info` issue owned by `core/node-superseded`.
    return [];
  },
};

function emitSupersedeButton(ctx: IAnalyzerContext, node: Node, options: IPickOption[]): void {
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
