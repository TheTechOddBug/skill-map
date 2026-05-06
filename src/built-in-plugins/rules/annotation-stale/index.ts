/**
 * `annotation-stale` rule (Step 9.6.2). Emits a `warn` issue per node
 * whose co-located `.sm` sidecar is stale relative to the current node
 * hashes — `node.sidecar.status` ∈ {`stale-body`, `stale-frontmatter`,
 * `stale-both`}.
 *
 * The kernel computes drift status at scan time (pure function over
 * `node.{bodyHash, frontmatterHash}` and the sidecar's stored
 * `for.{bodyHash, frontmatterHash}`); this rule just surfaces the
 * already-computed status as a graph-level warning so the standard
 * issue surface (CLI, UI, REST) discovers staleness without bespoke
 * plumbing.
 *
 * Severity is `warn` per Decision #4 — bumps are never auto-applied,
 * so stale state is advisory until the user runs `sm bump` (Step
 * 9.6.4).
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';
import { tx } from '../../../kernel/util/tx.js';
import { ANNOTATION_STALE_TEXTS } from '../../i18n/annotation-stale.texts.js';

const ID = 'annotation-stale';

export const annotationStaleRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  version: '1.0.0',
  description: 'Surfaces nodes whose co-located .sm sidecar is stale relative to current hashes.',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IRuleContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const status = node.sidecar?.status;
      if (status === undefined || status === null) continue;
      if (status === 'fresh') continue;
      const message =
        status === 'stale-body'
          ? tx(ANNOTATION_STALE_TEXTS.bodyDrift, { path: node.path })
          : status === 'stale-frontmatter'
            ? tx(ANNOTATION_STALE_TEXTS.frontmatterDrift, { path: node.path })
            : tx(ANNOTATION_STALE_TEXTS.bothDrift, { path: node.path });
      issues.push({
        ruleId: ID,
        severity: 'warn',
        nodeIds: [node.path],
        message,
        data: { status },
      });
    }
    return issues;
  },
};
