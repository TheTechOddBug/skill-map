/**
 * `score-resolution` rule, the kernel's own confidence model, dogfooded
 * through the public `score`-phase `adjustConfidence` API. It reads the
 * structural resolution FACTS the kernel computes (the post-walk lift's
 * `link.resolvedTarget`, plus `ctx.reservedNodePaths` and
 * `ctx.brokenLinks`) and assigns confidence, exactly as the lift used to
 * do inline:
 *
 *   - resolved to a real, non-virtual node          → `set 1.0`
 *   - resolved to a reserved target                 → `set 0.1`
 *   - resolved to a virtual node (`mcp://…`)         → no op (keep emit)
 *   - genuinely broken (no node anywhere)           → `ceil 0.5` (cap)
 *   - resolved by name but kind-mismatched          → no op (keep emit)
 *
 * Runs in the `score` phase, BEFORE the read-only `detect` analyzers, so
 * `core/name-reserved` (keyed on `confidence === 0.1`) and the persisted
 * `scan_links.confidence` see the final value. A third-party `score`
 * analyzer that adds/subtracts confidence composes on top of this
 * baseline via the same `adjustConfidence` callback.
 *
 * The `confidence < 1` gate mirrors the lift's old gate: links emitted
 * at full confidence (annotation `1.0`) were never adjusted.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Link, Node, TConfidenceOp } from '../../../../kernel/types.js';
import {
  BROKEN_TARGET_CONFIDENCE,
  RESERVED_TARGET_CONFIDENCE,
} from '../../../../kernel/orchestrator/confidence-constants.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'score-resolution';

export const scoreResolutionAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Assigns link confidence from the kernel resolution facts (resolved → 1.0, reserved → 0.1, broken → cap 0.5).',
  mode: 'deterministic',
  phase: 'score',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const adjust = ctx.adjustConfidence;
    if (!adjust) return []; // outside the score phase / legacy callers
    const nodeByPath = new Map<string, Node>();
    for (const node of ctx.nodes) nodeByPath.set(node.path, node);
    for (const link of ctx.links) {
      // Gate: matches the lift's old `< 1` (full-confidence annotation
      // links are never adjusted).
      if (link.confidence >= 1) continue;
      const op = scoreLink(link, nodeByPath, ctx.reservedNodePaths, ctx.brokenLinks);
      if (op) adjust(link, op);
    }
    return [];
  },
};

/**
 * Per-link confidence decision against the resolution facts. Returns the
 * op to apply, or `null` to leave the emit value untouched (virtual /
 * kind-mismatched / not-broken). Split out of `evaluate` to keep that
 * method's branch count under the lint complexity cap, mirroring the
 * lift's `applyResolution` helper.
 */
function scoreLink(
  link: Link,
  nodeByPath: ReadonlyMap<string, Node>,
  reserved: ReadonlySet<string> | undefined,
  broken: ReadonlySet<Link> | undefined,
): TConfidenceOp | null {
  const resolved = link.resolvedTarget;
  // Unresolved (absent or null): genuinely broken → cap; otherwise keep
  // the emit value.
  if (resolved === undefined || resolved === null) {
    return broken?.has(link) === true ? { kind: 'ceil', value: BROKEN_TARGET_CONFIDENCE } : null;
  }
  return scoreResolvedLink(resolved, nodeByPath, reserved);
}

/**
 * Confidence op for a link that DID resolve (`resolvedTarget` is a real
 * path). A virtual (unverified) target keeps its emit value; a reserved
 * target drops to `0.1`; everything else bumps to `1.0`.
 */
function scoreResolvedLink(
  resolved: string,
  nodeByPath: ReadonlyMap<string, Node>,
  reserved: ReadonlySet<string> | undefined,
): TConfidenceOp | null {
  if (nodeByPath.get(resolved)?.virtual === true) return null;
  return reserved?.has(resolved) === true
    ? { kind: 'set', value: RESERVED_TARGET_CONFIDENCE }
    : { kind: 'set', value: 1.0 };
}
