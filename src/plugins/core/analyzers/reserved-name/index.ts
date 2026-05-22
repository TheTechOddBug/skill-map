/**
 * `reserved-name` rule. Emits a `warn` issue for every user node whose
 * normalised identifier(s) collide with a name the Provider runtime
 * has reserved for its built-in invocables (e.g. Claude Code reserves
 * `/help`, `/clear`, `/init`, … for its own slash commands; an
 * author's `.claude/commands/help.md` is silently ignored by the
 * runtime).
 *
 * The orchestrator builds the set of reserved-by-runtime node paths
 * once per scan, intersecting each Provider's `reservedNames[kind]`
 * catalog with the merged graph (via the same `IProviderKind.identifiers`
 * sources used by the post-walk confidence-lift transform). This
 * analyzer is a pure projector: every entry of
 * `ctx.reservedNodePaths` becomes one warn issue. The intersection
 * itself lives in the orchestrator so the same set drives the
 * confidence downgrade in
 * `kernel/orchestrator/lift-resolved-link-confidence.ts`, the two
 * surfaces never go out of sync.
 *
 * `recommendedActions` is intentionally absent: the fix is operator-
 * driven (rename the file or its `frontmatter.name`), no per-node
 * action ships today.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { RESERVED_NAME_TEXTS } from './text.js';

const ID = 'reserved-name';

export const reservedNameAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Flags user nodes whose name collides with a Provider runtime\'s built-in invocable (the runtime shadows the file silently).',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const reserved = ctx.reservedNodePaths;
    if (!reserved || reserved.size === 0) return [];
    const byPath = new Map<string, Node>();
    for (const node of ctx.nodes) byPath.set(node.path, node);
    const issues: Issue[] = [];
    for (const path of reserved) {
      const node = byPath.get(path);
      if (!node) continue;
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [node.path],
        message: tx(RESERVED_NAME_TEXTS.message, {
          path: node.path,
          provider: node.provider,
          kind: node.kind,
        }),
        data: { provider: node.provider, kind: node.kind },
      });
    }
    return issues;
  },
};
