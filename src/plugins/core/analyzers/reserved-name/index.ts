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
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import { RESERVED_TARGET_CONFIDENCE } from '../../../../kernel/orchestrator/lift-resolved-link-confidence.js';
import { tx } from '../../../../kernel/util/tx.js';
import { RESERVED_NAME_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'reserved-name';

export const reservedNameAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Flags reserved-name collisions on two surfaces. Target side: a user file whose name collides with a Provider runtime\'s built-in invocable (the runtime shadows the file silently). Source side: a link that resolves to a reserved name, which the post-walk lift transform downgrades to the sentinel `RESERVED_TARGET_CONFIDENCE` (0.1). The two findings share the analyzer id so consumers can group by root cause; the source-side issue carries `data.target` matching the link so UIs can correlate per-row.',
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
        message: tx(RESERVED_NAME_TEXTS.message, {
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
    // a reserved-target resolution wins, so the analyzer reads the same
    // signal without re-implementing the resolution logic.
    for (const link of ctx.links) {
      if (link.confidence !== RESERVED_TARGET_CONFIDENCE) continue;
      const reservedNode = findReservedNodeForLink(link, reserved, byPath);
      if (!reservedNode) continue;
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [link.source],
        message: tx(RESERVED_NAME_TEXTS.linkMessage, {
          kind: link.kind,
          target: link.target,
          provider: reservedNode.provider,
          reservedKind: reservedNode.kind,
          reservedPath: reservedNode.path,
          confidence: RESERVED_TARGET_CONFIDENCE.toFixed(2),
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
 * Best-effort lookup for the reserved node a downgraded link resolves
 * to. Tries the path-style match first (`link.target` IS the reserved
 * node's path), then falls back to scanning the reserved set for a node
 * whose name matches the link's stripped normalised trigger. Returns
 * `null` only when neither path nor name evidence points at a reserved
 * node, which would mean the sentinel confidence came from a code path
 * outside the lift transform and the source-side finding is not safe to
 * synthesise.
 */
// eslint-disable-next-line complexity
function findReservedNodeForLink(
  link: Link,
  reserved: ReadonlySet<string>,
  byPath: Map<string, Node>,
): Node | null {
  if (reserved.has(link.target)) {
    const node = byPath.get(link.target);
    if (node) return node;
  }
  const trigger = link.trigger?.normalizedTrigger;
  if (!trigger) return null;
  const stripped = trigger.replace(/^[/@]/, '').trim();
  if (stripped.length === 0) return null;
  for (const path of reserved) {
    const node = byPath.get(path);
    if (!node) continue;
    if (matchesNodeIdentifier(node, stripped)) return node;
  }
  return null;
}

/**
 * Cheap identifier check, the analyzer is not in the post-walk indexes
 * loop so it cannot reuse `deriveNodeIdentifiers` directly without
 * threading the kindRegistry through. Hash-comparing the stripped
 * trigger against the node's `frontmatter.name`, filename basename, and
 * dirname covers every identifier source the closed-catalog
 * `TIdentifierSource` enum (`frontmatter.name` | `filename-basename` |
 * `dirname`) admits today. New sources land here when the enum grows.
 */
// eslint-disable-next-line complexity
function matchesNodeIdentifier(node: Node, stripped: string): boolean {
  const candidates: string[] = [];
  const fmName = node.frontmatter?.['name'];
  if (typeof fmName === 'string' && fmName.length > 0) candidates.push(normaliseId(fmName));
  const basename = node.path.split('/').pop() ?? '';
  if (basename) {
    const stem = basename.replace(/\.[^.]+$/, '');
    if (stem) candidates.push(normaliseId(stem));
  }
  const segs = node.path.split('/');
  if (segs.length >= 2) {
    const dirBase = segs[segs.length - 2];
    if (dirBase) candidates.push(normaliseId(dirBase));
  }
  return candidates.includes(stripped);
}

function normaliseId(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .replace(/  +/g, ' ')
    .trim();
}
