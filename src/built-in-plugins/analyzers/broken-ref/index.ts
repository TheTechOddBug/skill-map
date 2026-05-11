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
    for (const link of ctx.links) {
      if (isResolved(link, byPath, byNormalizedName)) continue;
      if (refIndex && resolvesViaReferencePaths(link, refIndex)) continue;
      issues.push(buildIssue(link));
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
