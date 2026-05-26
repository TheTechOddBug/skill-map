/**
 * `reference-broken` rule. Emits a `warn` issue for every link whose target
 * cannot be resolved to a node in the current scan:
 *
 * - Path-style targets (annotations extractor's output): target must
 *   match some `node.path` verbatim.
 * - Trigger-style targets (slash / at-directive extractors): resolution
 *   matches against `node.frontmatter.name` with the same normalization
 *   the extractor applied. An extractor's `/foo` link resolves to a node
 *   whose `frontmatter.name` normalizes to `foo`.
 *
 * **`scan.referencePaths` extension** (Step 9.7+), when the operator
 * has opted into a reference-paths side index, the rule consults it
 * BEFORE flagging a path-style link as broken: a target whose
 * absolute resolution (`resolve(ctx.cwd, link.target)`) is in
 * `ctx.referenceablePaths` is treated as "exists outside the indexed
 * graph" and the warning is suppressed. Trigger-style links don't
 * participate (a `/foo` invocation has no filesystem target).
 *
 * Rule is advisory, broken refs aren't errors; authors commonly
 * reference external or not-yet-scanned artifacts. Severity stays at
 * `warn`.
 */

import { posix as pathPosix, resolve } from 'node:path';

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { tx } from '../../../../kernel/util/tx.js';
import { REFERENCE_BROKEN_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'reference-broken';

export const referenceBrokenAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Flags arrows pointing at a node not part of the current scan.',
  mode: 'deterministic',

  // No `ui` declaration: this analyzer used to emit a per-finding
  // counter chip on `card.footer.right`, but that chip duplicated the
  // aggregate severity counters now owned by `core/issue-counter`. The
  // detection logic stays intact, only the chip emission is gone.
  ui: {},

  // The resolver, the reference-paths escape hatch, and the hint
  // index all share the per-link loop, splitting would re-walk
  // `ctx.links` once per concern. The per-source aggregation that
  // historically lived alongside (driving the now-retired chip
  // emission) moved into `core/issue-counter`.
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const byPath = new Set(ctx.nodes.map((n) => n.path));
    const byNormalizedName = indexByNormalizedName(ctx.nodes);
    // Hint index, nodes whose `frontmatter.name` is absent / empty but
    // whose filename basename matches a trigger. Used to nudge the
    // author toward the most likely fix (add `name: <x>`) when a
    // `@x` / `/x` link is broken AND a same-named file exists.
    const byBasenameWithoutName = indexByBasenameWithoutName(ctx.nodes);
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
      const candidates = findHintCandidates(link, byBasenameWithoutName);
      issues.push(buildIssue(link, candidates));
    }
    return issues;
  },
};

function buildIssue(link: Link, hintCandidates: Node[] = []): Issue {
  const data: Record<string, unknown> = {
    target: link.target,
    kind: link.kind,
    trigger: link.trigger?.normalizedTrigger ?? null,
  };
  const issue: Issue = {
    analyzerId: ID,
    // `error`, not `warn`: a link whose target is not in the scan is a
    // structural defect the operator must notice, and the card chip
    // paints `danger` (red) to match. Per the chip-vs-issue policy in
    // `context/view-slots.md`, a `danger` chip MUST be backed by an
    // `error` Issue so the visual signal lines up with the exit code
    // and the global error count on the card.
    severity: 'error',
    nodeIds: [link.source],
    message: tx(REFERENCE_BROKEN_TEXTS.message, {
      kind: link.kind,
      source: link.source,
      target: link.target,
    }),
    data,
  };
  if (hintCandidates.length > 0) {
    const suggestedName = (link.trigger?.normalizedTrigger ?? '')
      .replace(/^[/@]/, '')
      .trim();
    const candidatePaths = hintCandidates.map((n) => n.path);
    data['hint'] = {
      kind: 'missing-frontmatter-name',
      suggestedName,
      candidates: candidatePaths,
    };
    issue.fix = {
      summary:
        candidatePaths.length === 1
          ? tx(REFERENCE_BROKEN_TEXTS.hintSummarySingle, {
              name: suggestedName,
              candidate: candidatePaths[0]!,
            })
          : tx(REFERENCE_BROKEN_TEXTS.hintSummaryMany, {
              name: suggestedName,
              candidates: candidatePaths.join(', '),
            }),
      autofixable: false,
    };
  }
  return issue;
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

/**
 * Index nodes that DO NOT advertise a `frontmatter.name`, keyed by the
 * basename of `node.path` (extension stripped, normalized through the
 * same `normalizeTrigger` pipeline as the names index). Powers the
 * `data.hint` on the broken-ref issue: when `@c` does not resolve and
 * a file `c.md` exists without `name:`, the issue points the author
 * at the most likely fix.
 */
function basenameWithoutExt(path: string): string {
  const base = pathPosix.basename(path);
  const ext = pathPosix.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function indexByBasenameWithoutName(nodes: Node[]): Map<string, Node[]> {
  const out = new Map<string, Node[]>();
  for (const node of nodes) {
    const raw = node.frontmatter?.['name'];
    const name = typeof raw === 'string' ? raw : '';
    if (name) continue;
    const bare = basenameWithoutExt(node.path);
    if (!bare) continue;
    const key = normalizeTrigger(bare);
    if (!key) continue;
    const bucket = out.get(key) ?? [];
    bucket.push(node);
    out.set(key, bucket);
  }
  return out;
}

/**
 * For a broken trigger-style link (`@x` or `/x`), look up nodes whose
 * filename basename normalizes to `x` AND which do not advertise a
 * `frontmatter.name`. Returns `[]` for path-style links and for
 * triggers with no candidate file, callers treat that as "no hint".
 */
function findHintCandidates(link: Link, idx: Map<string, Node[]>): Node[] {
  const normalized = link.trigger?.normalizedTrigger;
  if (!normalized) return [];
  const sigil = normalized.charAt(0);
  if (sigil !== '/' && sigil !== '@') return [];
  const withoutSigil = normalized.slice(1).trim();
  if (!withoutSigil) return [];
  return idx.get(withoutSigil) ?? [];
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
