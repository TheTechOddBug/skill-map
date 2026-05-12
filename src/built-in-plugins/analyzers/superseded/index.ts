/**
 * `superseded` rule. Emits an `info` issue for every node whose sidecar
 * `.sm` `annotations:` block carries `supersededBy` — the author has
 * declared the node obsolete, so the rule just surfaces that
 * declaration as a graph-level finding.
 *
 * Does not inspect `annotations.stability: deprecated` on its own; a
 * deprecated node without a `supersededBy` is a different conversation
 * (the user wants to know *what replaces it*). That surface can land as
 * a separate rule once the use case materialises.
 *
 * **Companion declarer**: `core/mark-superseded` is the paired Action
 * (stub today). It is how the user *writes* the `supersededBy` field
 * this rule reads. No formal `IAnalyzer → IAction` wire exists in the
 * spec yet (no `fixAction` field on `IAnalyzer` or `Issue`); the link
 * lives in this docstring and the action's.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../kernel/types.js';
import { tx } from '../../../kernel/util/tx.js';
import { SUPERSEDED_TEXTS } from '../../i18n/superseded.texts.js';

const ID = 'superseded';

export const supersededAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Detects and marks nodes replaced by a newer one via `supersededBy`.',
  stability: 'stable',
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
        message: tx(SUPERSEDED_TEXTS.message, {
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
