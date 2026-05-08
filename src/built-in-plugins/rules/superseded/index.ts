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
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';
import { tx } from '../../../kernel/util/tx.js';
import { SUPERSEDED_TEXTS } from '../../i18n/superseded.texts.js';

const ID = 'superseded';

export const supersededRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  version: '1.0.0',
  description: 'Surfaces nodes whose sidecar annotations declare a supersededBy replacement.',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IRuleContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const sidecar = node.sidecar;
      if (!sidecar || sidecar.present !== true) continue;
      const ann = sidecar.annotations;
      if (!ann || typeof ann !== 'object' || Array.isArray(ann)) continue;
      const supersededBy = (ann as Record<string, unknown>)['supersededBy'];
      if (typeof supersededBy !== 'string' || supersededBy.length === 0) continue;

      issues.push({
        ruleId: ID,
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
