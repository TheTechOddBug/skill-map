/**
 * `superseded` rule. Emits an `info` issue for every node whose sidecar
 * `.sm` `annotations:` block carries `supersededBy`, the author has
 * declared the node obsolete, so the rule just surfaces that
 * declaration as a graph-level finding.
 *
 * Does not inspect `annotations.stability: deprecated` on its own; a
 * deprecated node without a `supersededBy` is a different conversation
 * (the user wants to know *what replaces it*). That surface can land as
 * a separate rule once the use case materialises.
 *
 * **Companion declarer (not fixer)**: `core/node-supersede` is the
 * per-node Action the user invokes to *write* the `supersededBy`
 * field this rule reads. It is intentionally NOT listed in
 * `recommendedActions`: when this analyzer fires, the user already
 * declared the supersession on purpose; there is nothing to "fix",
 * the analyzer is surfacing a deliberate fact. `node-supersede` is
 * still a valid per-node Action (it shows up in the inspector's
 * "applicable Actions" list via its own `IActionPrecondition`), it
 * just is not the resolution of THIS analyzer's issues.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { NODE_SUPERSEDED_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'node-superseded';

export const nodeSupersededAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Marks nodes replaced by a newer one via `supersededBy`.',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const supersededBy = pickSupersededBy(node);
      if (supersededBy === null) continue;
      issues.push({
        analyzerId: ID,
        severity: 'info',
        nodeIds: [node.path],
        message: tx(NODE_SUPERSEDED_TEXTS.message, {
          path: node.path,
          supersededBy,
        }),
        data: { supersededBy },
      });
    }
    return issues;
  },
};

/**
 * Extract `annotations.supersededBy` from a node's sidecar overlay.
 * Returns the trimmed non-empty string or `null` for any failure mode
 * (no sidecar, parse-time absent, non-object annotations block, missing
 * or non-string `supersededBy`). Co-located with the rule so the
 * traversal logic stays readable inside `evaluate`.
 */
function pickSupersededBy(node: Node): string | null {
  const sidecar = node.sidecar;
  if (!sidecar || sidecar.present !== true) return null;
  const ann = sidecar.annotations;
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) return null;
  const value = (ann as Record<string, unknown>)['supersededBy'];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}
