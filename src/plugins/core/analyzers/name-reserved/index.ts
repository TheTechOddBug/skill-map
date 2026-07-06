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
import type { Issue, Node } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { linkLines } from '../../../../kernel/util/link-lines.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { RESERVED_PENALTY } from '../../../../kernel/orchestrator/confidence-constants.js';
import { NAME_RESERVED_TEXTS } from './name-reserved.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'name-reserved';

export const nameReservedAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags two kinds of reserved-name collision: a file whose name shadows a built-in command of the active runtime, and a link that resolves to one of those reserved names.',
  mode: 'deterministic',
  phase: 'score',

  // eslint-disable-next-line complexity
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const reserved = ctx.reservedNodePaths;
    if (!reserved || reserved.size === 0) return [];
    const adjust = ctx.adjustConfidence; // present only in the score phase
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
        message: formatFinding({
          body: tx(NAME_RESERVED_TEXTS.message, {
            provider: node.provider,
            kind: node.kind,
          }),
        }),
        fix: { summary: tx(NAME_RESERVED_TEXTS.fixSummary) },
        data: { provider: node.provider, kind: node.kind, surface: 'target' },
      });
    }

    // Source-side issues: every link whose resolved target is a node the
    // runtime reserved gets a warn attached to its source, with
    // `data.target` matching the link so a UI listing the source's
    // outgoing links can correlate per-row. Detection reads the kernel
    // fact `link.resolvedTarget` (stamped by the post-walk lift) against
    // `reservedNodePaths`, NOT the link's confidence: now that confidence
    // is plugin-extensible (a `score`-phase plugin may move it, or
    // `core/score-resolution` may be disabled), gating on the old `0.1`
    // sentinel would silence a genuine collision. A link with no
    // `resolvedTarget`, or one resolving outside the reserved set, is
    // left alone.
    for (const link of ctx.links) {
      const reservedPath = link.resolvedTarget;
      if (!reservedPath || !reserved.has(reservedPath)) continue;
      const reservedNode = byPath.get(reservedPath);
      if (!reservedNode) continue;
      // Score side: the reserved built-in shadows this edge, so subtract
      // the reserved penalty from the kernel's 1.0 baseline (→ 0.1). A
      // fixed delta that composes with any other scorer; only gated on the
      // score-phase `adjust` being present (the warn below fires anyway).
      if (adjust) {
        adjust(link, { kind: 'delta', value: -RESERVED_PENALTY });
      }
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [link.source],
        message: formatFinding({
          subject: link.target,
          lines: linkLines(link),
          body: tx(NAME_RESERVED_TEXTS.linkMessage, {
            provider: reservedNode.provider,
            reservedKind: reservedNode.kind,
            reservedPath: reservedNode.path,
          }),
        }),
        fix: { summary: tx(NAME_RESERVED_TEXTS.linkFixSummary) },
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

