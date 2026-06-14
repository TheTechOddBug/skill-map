/**
 * `name-reserved` rule. Emits a `warn` issue for every user node whose
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

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import { RESERVED_TARGET_CONFIDENCE } from '../../../../kernel/orchestrator/confidence-constants.js';
import { tx } from '../../../../kernel/util/tx.js';
import { linkWhere } from '../../../../kernel/util/link-lines.js';
import { NAME_RESERVED_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'name-reserved';

export const nameReservedAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags two kinds of reserved-name collision: a file whose name shadows a built-in command of the active runtime, and a link that resolves to one of those reserved names.',
  mode: 'deterministic',

  // eslint-disable-next-line complexity
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const reserved = ctx.reservedNodePaths;
    if (!reserved || reserved.size === 0) return [];
    const byPath = new Map<string, Node>();
    for (const node of ctx.nodes) byPath.set(node.path, node);
    const issues: Issue[] = [];

    // Target-side issues (preserved behaviour): every reserved node
    // emits one warn issue attached to itself.
    for (const path of reserved) {
      const node = byPath.get(path);
      if (!node) continue;
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [node.path],
        message: tx(NAME_RESERVED_TEXTS.message, {
          path: node.path,
          provider: node.provider,
          kind: node.kind,
        }),
        data: { provider: node.provider, kind: node.kind, surface: 'target' },
      });
    }

    // Source-side issues: every link the lift transform downgraded to
    // `RESERVED_TARGET_CONFIDENCE` gets a warn attached to its source
    // with `data.target` matching the link, so a UI listing the source's
    // outgoing links can correlate per-row. Sentinel sharing is
    // intentional: the lift sets EXACTLY this value when (and only when)
    // a reserved-target resolution wins, and stamps `link.resolvedTarget`
    // with that reserved node's path in the same pass, so the analyzer
    // reads the resolved path back instead of re-deriving any identifier.
    for (const link of ctx.links) {
      if (link.confidence !== RESERVED_TARGET_CONFIDENCE) continue;
      // A sentinel value that did not come from a reserved resolution (no
      // `resolvedTarget`, or one pointing outside the reserved set) is
      // left alone, the source-side finding would not be safe to synthesise.
      const reservedPath = link.resolvedTarget;
      if (!reservedPath || !reserved.has(reservedPath)) continue;
      const reservedNode = byPath.get(reservedPath);
      if (!reservedNode) continue;
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [link.source],
        message: tx(NAME_RESERVED_TEXTS.linkMessage, {
          target: link.target,
          provider: reservedNode.provider,
          reservedKind: reservedNode.kind,
          reservedPath: reservedNode.path,
          confidence: RESERVED_TARGET_CONFIDENCE.toFixed(2),
          where: linkWhereSuffix(link),
        }),
        data: {
          target: link.target,
          kind: link.kind,
          surface: 'source',
          reservedPath: reservedNode.path,
          reservedProvider: reservedNode.provider,
          reservedKind: reservedNode.kind,
        },
      });
    }

    return issues;
  },
};

/**
 * Pre-rendered ` (line N)` / ` (lines N, M)` suffix naming where the
 * downgraded link sits in the source body; empty when the link carries
 * no line info (frontmatter / sidecar-derived edges).
 */
function linkWhereSuffix(link: Link): string {
  return linkWhere(link, {
    single: NAME_RESERVED_TEXTS.whereSingle,
    plural: NAME_RESERVED_TEXTS.wherePlural,
  });
}

