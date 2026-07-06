/**
 * `link-kind-conflict` rule. Surfaces detector disagreement.
 *
 * Two detectors that emit a link for the same `(source, target)` pair
 * coexist as separate rows in `scan_links`. No merge, no dedup. That
 * keeps the raw graph honest, but it leaves consumers without a signal
 * when detectors actually **disagree** on what the link means.
 * (Coexistence contract restated by Decision #127, which also carves
 * out the `points` kind below; the rule's original decision-log
 * citation predates the log renumbering.)
 *
 * Concrete example. A skill `audit-flow.md` declares
 *
 *     metadata:
 *       related: [security-scanner]
 *
 * AND its body says `Apoyate en /security-scanner para el paso 3.`
 *
 *   - `frontmatter` detector emits   (audit-flow → security-scanner, kind=references)
 *   - `slash`       detector emits   (audit-flow → security-scanner, kind=invokes)
 *
 * Same pair, different kinds. The author is sending two different
 * signals: "see-also navigation" (frontmatter) vs "I invoke this"
 * (body). The user usually wants to pick one, promote `related[]` to
 * `requires[]`, or remove the slash from the body.
 *
 * Rule contract:
 *
 *   - Links whose kind is in `NON_CONFLICTING_KINDS` are invisible to
 *     this rule: skipped before bucketing, never counted, never listed
 *     in the variant rollup.
 *   - Group the remaining links by `(source, target)` strings.
 *   - For each group, collect the distinct `kind` values across all
 *     emitted links. If size ≥ 2 → emit one `warn` issue.
 *   - Agreement (single kind across all detectors) is silent, that's
 *     the happy path. We don't emit `info` findings for cross-detector
 *     confirmation: it would generate massive noise on real graphs.
 *
 * Severity is `warn`, not `error`, the rule cannot tell which kind is
 * correct. The user has to decide. Exit-code propagation lives in the
 * CLI: warns do not fail the verb (per `spec/cli-contract.md` §Exit
 * codes, only `error`-severity issues flip exit 1).
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Confidence, Issue, Link, LinkKind } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { LINK_KIND_CONFLICT_TEXTS } from './link-kind-conflict.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'link-kind-conflict';

/**
 * Link kinds that never participate in disagreement detection. Per
 * Decision #127, `points` (code-region path pointer, emitted by
 * `core/backtick-path`) coexists with any other kind on the same
 * `(source, target)` pair by contract: a backtick `points` edge next
 * to a markdown `references` edge is the author using two
 * complementary surfaces, not two detectors disputing one meaning.
 * Rows of these kinds are invisible to this rule; a conflict needs
 * >= 2 distinct kinds among the REMAINING links.
 */
const NON_CONFLICTING_KINDS: ReadonlySet<LinkKind> = new Set(['points']);

interface ILinkVariant {
  kind: LinkKind;
  sources: string[];
  confidence: Confidence;
}

export const linkKindConflictAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Flags conflicting arrow meanings between extractors (e.g. `references` vs `invokes`).',
  mode: 'deterministic',

  // Bucket links by (source, target), then per-bucket detect distinct
  // kinds. The branching is intrinsic to the per-bucket conflict
  // detection.
  // eslint-disable-next-line complexity
  evaluate(ctx: IAnalyzerContext): Issue[] {
    // Group links by `${source}\0${target}`. Using a NUL separator is
    // safe for the path format we ship (POSIX, no NULs by spec).
    const groups = new Map<string, Link[]>();
    for (const link of ctx.links) {
      // Compatible-by-design kinds never enter a bucket: a `points`
      // row can neither create a conflict nor appear as a variant of
      // somebody else's dispute.
      if (NON_CONFLICTING_KINDS.has(link.kind)) continue;
      const key = `${link.source}\u0000${link.target}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(link);
      else groups.set(key, [link]);
    }

    const issues: Issue[] = [];
    for (const [key, links] of groups) {
      // No conflict possible with a single emitted link.
      if (links.length < 2) continue;

      // Count distinct kinds. Same-kind groups are silent, they're
      // either repeated emission from one detector (slash sees a
      // trigger twice) or genuine cross-detector agreement, which is
      // the happy path.
      const kinds = new Set(links.map((l) => l.kind));
      if (kinds.size < 2) continue;

      // Build the per-kind variant rollup so consumers know who
      // contributed what. Multiple links of the same kind from
      // multiple detectors collapse into one variant; sources from
      // each row are unioned, deduped, and sorted (deterministic).
      const variantByKind = new Map<LinkKind, ILinkVariant>();
      for (const link of links) {
        const existing = variantByKind.get(link.kind);
        if (existing) {
          for (const src of link.sources) {
            if (!existing.sources.includes(src)) existing.sources.push(src);
          }
          // Keep the highest-confidence value across rows of the
          // same kind. Order: high > medium > low.
          if (rankConfidence(link.confidence) > rankConfidence(existing.confidence)) {
            existing.confidence = link.confidence;
          }
        } else {
          variantByKind.set(link.kind, {
            kind: link.kind,
            sources: [...link.sources],
            confidence: link.confidence,
          });
        }
      }
      for (const v of variantByKind.values()) v.sources.sort();
      const variants = [...variantByKind.values()].sort((a, b) =>
        a.kind.localeCompare(b.kind),
      );

      const [source, target] = key.split('\u0000') as [string, string];
      const kindList = variants.map((v) => v.kind).join(' / ');
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [source, target],
        message: formatFinding({
          subject: target,
          body: tx(LINK_KIND_CONFLICT_TEXTS.message, {
            kindList,
          }),
        }),
        fix: { summary: tx(LINK_KIND_CONFLICT_TEXTS.fixSummary) },
        data: { source, target, variants },
      });
    }
    return issues;
  },
};

/**
 * Post-Phase-4 migration: `Confidence` is itself a numeric `[0..1]`
 * value, so rank reduces to identity. Retained as a function so the
 * call site (`rankConfidence(a) > rankConfidence(b)`) keeps reading
 * as a "higher wins" comparison.
 */
function rankConfidence(c: Confidence): number {
  return c;
}
