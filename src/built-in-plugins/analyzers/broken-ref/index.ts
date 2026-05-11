/**
 * `broken-ref` rule. Emits a `warn` issue for every link whose target
 * cannot be resolved to a node in the current scan:
 *
 * - Path-style targets (annotations extractor's output): target must
 *   match some `node.path` verbatim.
 * - Trigger-style targets (slash / at-directive extractors): resolution
 *   matches against `node.frontmatter.name` with the same normalization
 *   the extractor applied. An extractor's `/foo` link resolves to a node
 *   whose `frontmatter.name` normalizes to `foo`.
 *
 * **`scan.referencePaths` extension** (Step 9.7+) — when the operator
 * has opted into a reference-paths side index, the rule consults it
 * BEFORE flagging a path-style link as broken: a target whose
 * absolute resolution (`resolve(ctx.cwd, link.target)`) is in
 * `ctx.referenceablePaths` is treated as "exists outside the indexed
 * graph" and the warning is suppressed. Trigger-style links don't
 * participate (a `/foo` invocation has no filesystem target).
 *
 * Rule is advisory — broken refs aren't errors; authors commonly
 * reference external or not-yet-scanned artifacts. Severity stays at
 * `warn`.
 */

import { resolve } from 'node:path';

import type { IAnalyzer, IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../kernel/types.js';
import { normalizeTrigger } from '../../../kernel/trigger-normalize.js';
import { tx } from '../../../kernel/util/tx.js';
import { BROKEN_REF_TEXTS } from '../../i18n/broken-ref.texts.js';

const ID = 'broken-ref';

export const brokenRefAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Flags arrows pointing at a node that is not part of the current scan (broken link).',
  stability: 'stable',
  mode: 'deterministic',

  viewContributions: {
    // Corner badge on the graph card; count omitted when there is a
    // single broken ref (avoids a noisy "icon + 1" chip).
    alert: {
      slot: 'graph.node.alert',
      icon: 'fa-solid fa-circle-xmark',
      emitWhenEmpty: false,
    },
    // Footer chip on the card. `_counter` shape — `value` always shows,
    // so the operator sees "how many" at a glance. Renders OUTLINED
    // (`fa-regular`) so the corner alert (filled, attention-grabbing)
    // and the footer chip (quieter, paired with a number) read as two
    // beats of the same signal rather than two identical glyphs.
    chip: {
      slot: 'card.footer.right',
      icon: 'fa-regular fa-circle-xmark',
      emitWhenEmpty: false,
    },
  },

  // The resolver, the reference-paths escape hatch, the per-source
  // aggregation, and the dual-slot emit (with single/plural tooltip and
  // optional count) all live in one flow because they share the per-link
  // loop. Splitting them would re-walk `ctx.links` three times.
  // eslint-disable-next-line complexity
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const byPath = new Set(ctx.nodes.map((n) => n.path));
    const byNormalizedName = indexByNormalizedName(ctx.nodes);
    // `scan.referencePaths` escape hatch: only consulted when both
    // the side index and the cwd are wired (legacy callers omit
    // either / both). Pre-cap so we can short-circuit cheaply.
    const refIndex =
      ctx.referenceablePaths && ctx.referenceablePaths.size > 0 && ctx.cwd
        ? { paths: ctx.referenceablePaths, cwd: ctx.cwd }
        : null;

    const issues: Issue[] = [];
    // Per-source aggregation so we emit ONE badge / chip per node,
    // not one per issue. A node with three broken refs lights up
    // once with `count = 3`, not three overlapping markers.
    const perNode = new Map<string, number>();
    for (const link of ctx.links) {
      if (isResolved(link, byPath, byNormalizedName)) continue;
      if (refIndex && resolvesViaReferencePaths(link, refIndex)) continue;
      issues.push(buildIssue(link));
      perNode.set(link.source, (perNode.get(link.source) ?? 0) + 1);
    }
    for (const [nodePath, count] of perNode) {
      const tooltip =
        count === 1
          ? BROKEN_REF_TEXTS.alertTooltipSingle
          : tx(BROKEN_REF_TEXTS.alertTooltipMany, { count });
      const capped = Math.min(count, 99);
      // Alert badge renders icon-only (no count). The tooltip still surfaces
      // the "X broken references" message; the count is also visible in the
      // footer chip below for users who want the number at a glance.
      ctx.emitContribution(nodePath, 'alert', {
        icon: 'fa-solid fa-circle-xmark',
        severity: 'danger',
        tooltip,
      });
      ctx.emitContribution(nodePath, 'chip', {
        value: capped,
        severity: 'danger',
        tooltip,
      });
    }
    return issues;
  },
};

function buildIssue(link: Link): Issue {
  return {
    analyzerId: ID,
    severity: 'warn',
    nodeIds: [link.source],
    message: tx(BROKEN_REF_TEXTS.message, {
      kind: link.kind,
      source: link.source,
      target: link.target,
    }),
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

function indexByNormalizedName(nodes: Node[]): Map<string, Node[]> {
  const out = new Map<string, Node[]>();
  for (const node of nodes) {
    const raw = node.frontmatter?.['name'];
    const name = typeof raw === 'string' ? raw : '';
    if (!name) continue;
    const key = normalizeTrigger(name);
    const bucket = out.get(key) ?? [];
    bucket.push(node);
    out.set(key, bucket);
  }
  return out;
}

function isResolved(
  link: Link,
  byPath: Set<string>,
  byNormalizedName: Map<string, Node[]>,
): boolean {
  // Trigger-style: compare against normalized name index. An extractor may
  // have emitted `/deploy` or `@agent-name`; strip the leading sigil
  // before normalising for the name lookup.
  const normalized = link.trigger?.normalizedTrigger;
  if (normalized) {
    const withoutSigil = normalized.replace(/^[/@]/, '').trim();
    if (byNormalizedName.has(withoutSigil)) return true;
  }

  // Path-style (frontmatter-derived links) or fallback: verbatim path
  // must exist in the scan.
  if (byPath.has(link.target)) return true;

  return false;
}

/**
 * Path-style links are the ones that participate in the
 * `referenceablePaths` lookup. Trigger-style invocations carry a
 * `normalizedTrigger` that begins with a sigil (`/` for slash
 * commands, `@` for at-directives) and have no filesystem target,
 * so the side index doesn't apply. Everything else (frontmatter
 * annotations → `references` / `supersedes`, markdown links →
 * `references`) is treated as path-style and gets the lookup.
 */
function isPathStyleLink(link: Link): boolean {
  const sigil = link.trigger?.normalizedTrigger?.charAt(0);
  if (sigil === '/' || sigil === '@') return false;
  return true;
}
