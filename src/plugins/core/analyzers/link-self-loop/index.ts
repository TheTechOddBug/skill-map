/**
 * `link-self-loop` rule. Flags every link whose source is its own resolved
 * target. The typical case is the file's own heading written as an
 * invocation token (`# /deploy` inside `.claude/commands/deploy.md`),
 * which the `slash` extractor emits as an `invokes` link, the post-
 * walk lift transform then resolves back to the source node and bumps
 * to confidence 1.0. Mechanically correct, almost always noise.
 *
 * Detection: `link.source === link.target` OR `link.source ===
 * link.resolvedTarget`. The second arm covers trigger-style links
 * (`/foo` inside `foo.md`) that the lift transform resolved by name;
 * the first covers path-style links that pointed at their own file
 * directly.
 *
 * Surface: one warn issue per self-looping link, attached to the
 * source. The kernel does NOT drop the link, persistence stays
 * lossless; the issue is the operator-facing signal that a self-
 * reference exists. The graph view does NOT consume this issue: it
 * runs its own render-pipeline mirror (`analyzeLinks` in
 * `ui/src/app/views/graph-view/graph-layout.ts`) that recomputes the
 * `source === resolvedTarget` predicate to decide which edges to draw
 * and to count self-loops in the topbar. The two are deliberately
 * independent (this rule reports, the layout draws); there is no
 * shared `data` flag to keep in sync.
 *
 * Severity is `warn` (matches the other "consider consolidating"
 * analyzers like `reference-redundant`). No autofix today,
 * the fix is operator-driven (delete the in-body token or change the
 * heading wording).
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { isSelfLoop, linkWhere } from '../../../../kernel/util/link-lines.js';
import { LINK_SELF_LOOP_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'link-self-loop';

export const linkSelfLoopAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags links whose source is also their own resolved target (e.g. a body heading like `# /deploy` inside the file that defines `/deploy`).',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    if (ctx.links.length === 0) return [];
    const issues: Issue[] = [];
    for (const link of ctx.links) {
      if (!isSelfLoop(link)) continue;
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [link.source],
        message: tx(LINK_SELF_LOOP_TEXTS.message, {
          trigger: link.trigger?.originalTrigger ?? link.target,
          kind: link.kind,
          where: linkWhere(link, {
            single: LINK_SELF_LOOP_TEXTS.whereSingle,
            plural: LINK_SELF_LOOP_TEXTS.wherePlural,
          }),
        }),
        data: {
          target: link.target,
          resolvedTarget: link.resolvedTarget ?? link.target,
          kind: link.kind,
        },
      });
    }
    return issues;
  },
};
