/**
 * `reference-broken` rule. Emits one `error` issue per link the
 * orchestrator judged genuinely broken (`IAnalyzerContext.brokenLinks`):
 * the target matches no node `path`, the stripped trigger matches no
 * entry in the cross-kind name index, AND (for path-style links) the
 * target names no on-disk entry under any scan root (the existence
 * probe, `kernel/orchestrator/link-target-probe.ts`: a reference to a
 * real-but-unindexed file such as a `.json` schema is not broken). That
 * verdict is computed once by the post-walk lift (`collectBrokenLinks`)
 * from the same `deriveNodeIdentifiers`-backed index that drives the
 * confidence downgrade, so the rule and the lift agree by construction:
 * a `@foo` that resolves only via the file's basename / dirname
 * identifier (not its `frontmatter.name`) is NOT broken. The rule used
 * to re-derive a narrower frontmatter-name-only index, which flagged
 * such links as broken even though the lift resolved them with full
 * confidence; the two now share one source of truth, per
 * `spec/architecture.md` §Provider · resolution rules ("a name-only
 * resolution is enough to clear the broken flag").
 *
 * **`scan.referencePaths` extension** (Step 9.7+): when the operator
 * has opted into a reference-paths side index, the rule consults it
 * BEFORE surfacing a path-style broken link: a target whose absolute
 * resolution (`resolve(ctx.cwd, link.target)`) is in
 * `ctx.referenceablePaths` is treated as "exists outside the indexed
 * graph" and suppressed. Trigger-style links don't participate (a `/foo`
 * invocation has no filesystem target).
 *
 * **Operator dismissals** (`annotations.issueSuppressions`, the value
 * grain): a `.sm` entry matching this analyzer and the link's verbatim
 * target skips BOTH the issue and the confidence penalty, at emission
 * time (`spec/db-schema.md` §scan_issues; issues are regenerated
 * wholesale per scan, so there is no read-time lens to hide behind).
 * Written by `sm issues dismiss` / the inspector's per-issue dismiss.
 *
 * Severity is two-tier: `error` for a genuinely dangling authored
 * reference (a structural defect the operator must notice; the card
 * chip paints `danger` to match, per `context/view-slots.md`), `warn`
 * when the unresolved `@`-trigger token is CODE-SHAPED per
 * `kernel/util/code-shaped-token.ts` (uppercase identifier like
 * `@ApiSecurity`, or npm-scope package like `@nestjs/swagger`): prose
 * about code is likelier than a typoed reference there, so the signal
 * stays visible (amber `warnCount` chip) without tripping the exit-1
 * contract (`spec/cli-contract.md` §Exit codes fires on `error` only).
 * The confidence penalty is IDENTICAL in both tiers, broken is broken;
 * only the operator-facing severity differs. The author-facing "add
 * `name:`" nudge that used to ride along here was retired with the
 * resolution consolidation: a same-named file is now reachable via its
 * basename / dirname identifier (so the link resolves rather than
 * breaking), and the case where a name truly is required is already
 * surfaced by `core/schema-violation` ("Missing required frontmatter:
 * name").
 */

import { resolve } from 'node:path';

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { linkLines } from '../../../../kernel/util/link-lines.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { isCodeShapedAtToken } from '../../../../kernel/util/code-shaped-token.js';
import {
  isIssueSuppressed,
  issueSuppressionsFromAnnotations,
  type IIssueSuppressionEntry,
} from '../../../../kernel/util/issue-suppressions.js';
import { BROKEN_PENALTY } from '../../../../kernel/orchestrator/confidence-constants.js';
import { REFERENCE_BROKEN_TEXTS } from './reference-broken.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'reference-broken';

/** Qualified id issue-suppression entries are matched against. */
const QUALIFIED_ID = `${CORE_PLUGIN_ID}/${ID}`;

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
    const suppressions = buildIssueSuppressionIndex(ctx);
    const adjust = ctx.adjustConfidence; // present only in the score phase

    const issues: Issue[] = [];
    for (const link of ctx.links) {
      if (!broken.has(link)) continue;
      const verdict = classifyBrokenLink(link, refIndex, suppressions);
      traceVerdict(ctx, link, verdict);
      if (verdict !== 'report') continue;
      // Score side: penalize a genuinely-broken edge (delta -0.75 → 0.25).
      // The penalty follows the issue (all three guards above skip both),
      // so detection and scoring stay one decision.
      penalizeBrokenConfidence(adjust, link);
      issues.push(buildIssue(link));
    }
    return issues;
  },
};

/**
 * Why a broken edge was, or was not, reported. Extracted so `evaluate`
 * stays a flat loop: the three outcomes are one decision, and naming
 * them lets the trace line below say WHICH one fired.
 */
type TBrokenVerdict = 'report' | 'resolved-via-reference-paths' | 'dismissed-by-operator';

function classifyBrokenLink(
  link: Link,
  refIndex: ReturnType<typeof buildReferenceIndex>,
  suppressions: ReturnType<typeof buildIssueSuppressionIndex>,
): TBrokenVerdict {
  if (refIndex && resolvesViaReferencePaths(link, refIndex)) {
    return 'resolved-via-reference-paths';
  }
  if (isDismissedByOperator(link, suppressions)) return 'dismissed-by-operator';
  return 'report';
}

/**
 * `--log trace`: the answer to the commonest "this is a false positive" report.
 * A broken edge is dropped for three DIFFERENT reasons and from the
 * outside all three look identical (no issue). Naming which one fired is
 * the difference between the operator debugging their corpus and
 * debugging us.
 *
 * Guarded: this runs once per link in the whole graph, and the argument
 * would be built even when the level discards it.
 */
function traceVerdict(ctx: IAnalyzerContext, link: Link, verdict: TBrokenVerdict): void {
  if (!ctx.log.enabled('trace')) return;
  const why =
    verdict === 'report'
      ? `unresolved (${link.kind}), reporting`
      : verdict === 'resolved-via-reference-paths'
        ? 'broken, but resolved via scan.referencePaths'
        : 'broken, but dismissed by the operator (.sm issueSuppressions)';
  ctx.log.trace(`${link.source} -> ${link.target}: ${why}`);
}

/**
 * Per-evaluate index of the operators' issue suppressions, keyed by
 * node path (the future `link.source`). Sourced from the raw sidecar
 * roots when the orchestrator threaded them (the zero-file-I/O path,
 * same access pattern as `annotation-field-unknown`), else from the
 * node's typed sidecar overlay. Nodes without entries stay absent so
 * the per-link guard is a cheap map miss.
 */
function buildIssueSuppressionIndex(
  ctx: IAnalyzerContext,
): ReadonlyMap<string, IIssueSuppressionEntry[]> {
  const index = new Map<string, IIssueSuppressionEntry[]>();
  for (const node of ctx.nodes) {
    const entries = issueSuppressionsFromAnnotations(nodeAnnotations(ctx, node));
    if (entries.length > 0) index.set(node.path, entries);
  }
  return index;
}

/**
 * A node's annotations block: raw sidecar root when threaded (zero
 * file I/O), else the typed overlay. Split out for the complexity cap.
 */
function nodeAnnotations(ctx: IAnalyzerContext, node: Node): unknown {
  const fromRoots = ctx.sidecarRoots?.get(node.path)?.['annotations'];
  if (fromRoots !== undefined && fromRoots !== null) return fromRoots;
  return node.sidecar?.annotations ?? null;
}

/**
 * The operator-dismissal guard: an active (analyzer, value) entry on
 * the SOURCE node matching this analyzer (qualified or bare) and the
 * link's verbatim target skips the issue AND the penalty.
 */
function isDismissedByOperator(
  link: Link,
  suppressions: ReadonlyMap<string, IIssueSuppressionEntry[]>,
): boolean {
  const entries = suppressions.get(link.source);
  if (!entries) return false;
  return isIssueSuppressed(QUALIFIED_ID, link.target, entries);
}

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
 * (delta -0.75 → 0.25). A fixed delta that composes with any other scorer;
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

/**
 * Two-tier severity gate: `warn` fires only for a broken `@`-TRIGGER
 * whose verbatim token is code-shaped (`@ApiSecurity`,
 * `@nestjs/swagger`): prose about code, visible in the amber
 * `warnCount` bucket, never exit-1. The shape test reads `link.target`
 * (case preserved); `normalizedTrigger` is lowercased and only
 * supplies the sigil check.
 */
function isCodeShapedTriggerLink(link: Link): boolean {
  return (
    link.trigger?.normalizedTrigger?.startsWith('@') === true && isCodeShapedAtToken(link.target)
  );
}

/** Human noun for the message, with the off-catalog fallback. */
function kindLabelFor(link: Link): string {
  return (
    REFERENCE_BROKEN_TEXTS.kindLabels[link.kind] ??
    tx(REFERENCE_BROKEN_TEXTS.kindLabelFallback, { kind: link.kind })
  );
}

function buildIssue(link: Link): Issue {
  // `error` is the default (a dangling authored reference is a
  // structural defect; the `danger` chip stays backed by an `error`
  // Issue per the chip-vs-issue policy in `context/view-slots.md`, so
  // red lines up with the exit code); the code-shaped gate above is the
  // only downgrade to `warn`.
  const codeShaped = isCodeShapedTriggerLink(link);
  const kindLabel = kindLabelFor(link);
  return {
    analyzerId: ID,
    severity: codeShaped ? 'warn' : 'error',
    nodeIds: [link.source],
    message: formatFinding({
      subject: link.target,
      lines: linkLines(link),
      body: tx(
        codeShaped ? REFERENCE_BROKEN_TEXTS.messageCodeShaped : REFERENCE_BROKEN_TEXTS.message,
        { kindLabel },
      ),
    }),
    fix: {
      summary: tx(
        codeShaped ? REFERENCE_BROKEN_TEXTS.fixSummaryCodeShaped : REFERENCE_BROKEN_TEXTS.fixSummary,
      ),
    },
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
