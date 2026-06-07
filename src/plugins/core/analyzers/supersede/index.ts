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
 *     contribution. The button is always present (the persistence
 *     upsert refreshes the row each scan); the payload's `enabled` flag
 *     carries the dynamic gate.
 *   - `enabled` is `false` when the node's sidecar already carries a
 *     non-empty `annotations.supersededBy` (re-declaring is a no-op; the
 *     right UX there is "remove" or "change", out of scope today). The
 *     `disabledReason` tooltip explains why.
 *   - The payload's `prompt` declares a `single-string` input the UI
 *     collects (`supersededBy` = the target node path) before dispatch.
 *   - `node.virtual === true` nodes are skipped entirely: there is no
 *     point declaring supersession on a synthesised node.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../../kernel/types.js';
import { SUPERSEDE_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'supersede';

export const supersedeAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Projects the inspector "Supersede" button (declares a node replaced by another).',
  mode: 'deterministic',

  ui: {
    // Inspector action button that dispatches `core/node-supersede`.
    // Always emitted for non-virtual nodes; the payload's `enabled` flag
    // carries the dynamic gate (disabled once already superseded).
    supersedeButton: {
      slot: 'inspector.action.button',
      priority: 10,
    },
  },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    for (const node of ctx.nodes) {
      // No point declaring supersession on a synthesised node.
      if (node.virtual === true) continue;
      emitSupersedeButton(ctx, node.path, !alreadySuperseded(node));
    }
    // This analyzer surfaces no issues; the declaration itself is an
    // `info` issue owned by `core/node-superseded`.
    return [];
  },
};

function emitSupersedeButton(ctx: IAnalyzerContext, nodePath: string, enabled: boolean): void {
  ctx.emitContribution(nodePath, 'supersedeButton', {
    actionId: 'core/node-supersede',
    label: SUPERSEDE_TEXTS.supersedeLabel,
    icon: 'pi-arrow-right-arrow-left',
    enabled,
    ...(enabled ? {} : { disabledReason: SUPERSEDE_TEXTS.supersedeDisabledReason }),
    prompt: {
      inputType: 'single-string',
      paramKey: 'supersededBy',
      label: SUPERSEDE_TEXTS.supersedePromptLabel,
    },
  });
}

/**
 * Whether a node's sidecar overlay already carries a non-empty
 * `annotations.supersededBy`. Mirrors the read in
 * `core/node-superseded` so the enabled gate and the issue surface
 * agree on what "already superseded" means.
 */
function alreadySuperseded(node: Node): boolean {
  const sidecar = node.sidecar;
  if (!sidecar || sidecar.present !== true) return false;
  const ann = sidecar.annotations;
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) return false;
  const value = (ann as Record<string, unknown>)['supersededBy'];
  return typeof value === 'string' && value.length > 0;
}
