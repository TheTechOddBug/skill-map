/**
 * `reference-broken` rule. Emits one `error` issue per link the
 * orchestrator judged genuinely broken (`IAnalyzerContext.brokenLinks`):
 * the target matches no node `path` AND the stripped trigger matches no
 * entry in the cross-kind name index. That verdict is computed once by
 * the post-walk lift (`collectBrokenLinks`) from the same
 * `deriveNodeIdentifiers`-backed index that drives the confidence
 * downgrade, so the rule and the lift agree by construction: a `@foo`
 * that resolves only via the file's basename / dirname identifier (not
 * its `frontmatter.name`) is NOT broken. The rule used to re-derive a
 * narrower frontmatter-name-only index, which flagged such links as
 * broken even though the lift resolved them with full confidence; the
 * two now share one source of truth, per `spec/architecture.md`
 * §Provider · resolution rules ("a name-only resolution is enough to
 * clear the broken flag").
 *
 * **`scan.referencePaths` extension** (Step 9.7+): when the operator
 * has opted into a reference-paths side index, the rule consults it
 * BEFORE surfacing a path-style broken link: a target whose absolute
 * resolution (`resolve(ctx.cwd, link.target)`) is in
 * `ctx.referenceablePaths` is treated as "exists outside the indexed
 * graph" and suppressed. Trigger-style links don't participate (a `/foo`
 * invocation has no filesystem target).
 *
 * Severity is `error`: a link pointing at nothing is a structural defect
 * the operator must notice (the card chip paints `danger` to match, per
 * `context/view-slots.md`). The author-facing "add `name:`" nudge that
 * used to ride along here was retired with the resolution consolidation:
 * a same-named file is now reachable via its basename / dirname
 * identifier (so the link resolves rather than breaking), and the case
 * where a name truly is required is already surfaced by
 * `core/schema-violation` ("Missing required frontmatter: name").
 */

import { resolve } from 'node:path';

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Link } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { linkLines } from '../../../../kernel/util/link-lines.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { BROKEN_PENALTY } from '../../../../kernel/orchestrator/confidence-constants.js';
import { REFERENCE_BROKEN_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'reference-broken';

export const referenceBrokenAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Flags arrows pointing at a node not part of the current scan.',
  mode: 'deterministic',
  phase: 'score',

  // No `ui` declaration: this analyzer used to emit a per-finding
  // counter chip on `card.footer.right`, but that chip duplicated the
  // aggregate severity counters now owned by `core/issue-counter`. The
  // detection logic stays intact, only the chip emission is gone.
  ui: {},

  // Pure projector of the orchestrator's genuinely-broken verdict
  // (`ctx.brokenLinks`, computed once from the same name index the
  // confidence lift uses), with the reference-paths escape hatch layered
  // on top. The per-source aggregation that historically lived alongside
  // (driving the now-retired chip emission) moved into
  // `core/issue-counter`.
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const broken = ctx.brokenLinks;
    if (!broken || broken.size === 0) return [];
    const refIndex = buildReferenceIndex(ctx);
    const adjust = ctx.adjustConfidence; // present only in the score phase

    const issues: Issue[] = [];
    for (const link of ctx.links) {
      if (!broken.has(link)) continue;
      if (refIndex && resolvesViaReferencePaths(link, refIndex)) continue;
      // Score side: penalize a genuinely-broken edge (delta -0.5 → 0.5).
      // The penalty follows the issue (both skip the reference-paths-
      // resolved links above), so detection and scoring stay one decision.
      penalizeBrokenConfidence(adjust, link);
      issues.push(buildIssue(link));
    }
    return issues;
  },
};

/**
 * Pre-cap the `scan.referencePaths` escape hatch: only usable when both
 * the side index and the cwd are wired (legacy callers omit either /
 * both). Returns `null` when the hatch is unavailable so the per-link
 * loop short-circuits cheaply.
 */
function buildReferenceIndex(
  ctx: IAnalyzerContext,
): { paths: ReadonlySet<string>; cwd: string } | null {
  if (!ctx.referenceablePaths || ctx.referenceablePaths.size === 0 || !ctx.cwd) return null;
  return { paths: ctx.referenceablePaths, cwd: ctx.cwd };
}

/**
 * Score side: subtract the broken penalty from the kernel's 1.0 baseline
 * (delta -0.5 → 0.5). A fixed delta that composes with any other scorer;
 * only gated on the score-phase `adjust` being present (the error issue
 * fires regardless). Split out of `evaluate` to keep its branch count
 * under the lint complexity cap.
 */
function penalizeBrokenConfidence(
  adjust: IAnalyzerContext['adjustConfidence'],
  link: Link,
): void {
  if (adjust) {
    adjust(link, { kind: 'delta', value: -BROKEN_PENALTY });
  }
}

function buildIssue(link: Link): Issue {
  return {
    analyzerId: ID,
    // `error`, not `warn`: a link whose target is not in the scan is a
    // structural defect the operator must notice, and the card chip
    // paints `danger` (red) to match. Per the chip-vs-issue policy in
    // `context/view-slots.md`, a `danger` chip MUST be backed by an
    // `error` Issue so the visual signal lines up with the exit code
    // and the global error count on the card.
    severity: 'error',
    nodeIds: [link.source],
    message: formatFinding({
      subject: link.target,
      lines: linkLines(link),
      body: tx(REFERENCE_BROKEN_TEXTS.message, {
        kindLabel:
          REFERENCE_BROKEN_TEXTS.kindLabels[link.kind] ??
          tx(REFERENCE_BROKEN_TEXTS.kindLabelFallback, { kind: link.kind }),
      }),
    }),
    fix: { summary: tx(REFERENCE_BROKEN_TEXTS.fixSummary) },
    data: {
      target: link.target,
      kind: link.kind,
      trigger: link.trigger?.normalizedTrigger ?? null,
    },
  };
}

/**
 * Last-chance escape hatch: when `scan.referencePaths` is configured,
 * a path-style link whose absolute resolution lands in the side
 * index is treated as resolved (file exists on disk outside the
 * indexed graph).
 */
function resolvesViaReferencePaths(
  link: Link,
  refIndex: { paths: ReadonlySet<string>; cwd: string },
): boolean {
  if (!isPathStyleLink(link)) return false;
  return refIndex.paths.has(resolve(refIndex.cwd, link.target));
}

/**
 * Path-style links are the ones that participate in the
 * `referenceablePaths` lookup. Trigger-style invocations carry a
 * `normalizedTrigger` that begins with a sigil (`/` for slash
 * commands, `@` for at-directives) and have no filesystem target,
 * so the side index doesn't apply. Everything else (markdown links →
 * `references`) is treated as path-style and gets the lookup.
 */
function isPathStyleLink(link: Link): boolean {
  const sigil = link.trigger?.normalizedTrigger?.charAt(0);
  if (sigil === '/' || sigil === '@') return false;
  return true;
}
