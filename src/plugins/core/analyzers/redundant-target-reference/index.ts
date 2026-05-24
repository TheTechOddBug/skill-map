/**
 * `redundant-target-reference` rule. Flags every (source, resolved-target)
 * pair the body alludes to via more than one syntactic surface, e.g.:
 *
 *   - `@./real-agent.md` + `[link](./real-agent.md)` (same kind,
 *     two extractors converged on one dedup key, occurrences > 1)
 *   - `/deploy` + `[deploy](./commands/deploy.md)` (different kinds,
 *     two distinct edges, but both end at the same node)
 *   - `@real-agent` + `@./real-agent.md` (mentions + references both
 *     point at the same agent node)
 *
 * The runtime implication: when an LLM-driven runtime walks the body,
 * each form fires its own semantic action (`@<path>` inlines, `/cmd`
 * invokes, `[label](path)` is decorative). Multi-form to one target
 * is rarely a runtime bug, but it IS noise the operator usually wants
 * to consolidate (double inlining wastes context tokens; rename ops
 * must touch every form).
 *
 * Detection model:
 *
 *   1. For each link, compute the RESOLVED target node path. Path-style
 *      targets resolve trivially (`link.target` IS a node path).
 *      Trigger-style targets (sigil prefix) resolve via the same name
 *      index `liftResolvedLinkConfidence` consults: strip the leading
 *      `@` / `/`, match against `frontmatter.name` / filename basename
 *      / dirname normalised through `normalizeTrigger`. Links that do
 *      not resolve to any node are skipped, `core/broken-ref` already
 *      flags those.
 *   2. Group links by `(source, resolvedTarget)`.
 *   3. Sum the `occurrences[]` lengths across every link in the group.
 *      A group with `total >= 2` emits one warn on the source naming
 *      every occurrence (kind + trigger + line) and the resolved target.
 *
 * Why occurrences sum (not edge count) drives detection: extractor-level
 * dedup collapses repeated same-form sites (e.g. `@./foo.md` twice in
 * the same body emits one Link with one occurrence today, the
 * within-extractor dedup eats the duplicate). Once that lid is lifted,
 * `occurrences.length >= 2` on a single edge also fires the rule.
 * Today the typical case is two extractors converging on one edge
 * (`sources.length === 2`, `occurrences.length === 2`).
 *
 * Severity is `warn` (matches `broken-ref` / `reserved-name`). Mitigation
 * is operator-driven (delete the redundant occurrence(s) or keep them
 * deliberately), no autofix ships today.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { tx } from '../../../../kernel/util/tx.js';
import { REDUNDANT_TARGET_REFERENCE_TEXTS as TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'redundant-target-reference';

export const redundantTargetReferenceAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Flags when one node references the same target through two or more different links (e.g. a markdown link plus a `references:` entry).',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    if (ctx.links.length === 0) return [];
    const byPath = new Map<string, Node>();
    for (const node of ctx.nodes) byPath.set(node.path, node);
    const byName = buildNameIndex(ctx.nodes);

    // Group key: `${source}\x00${resolvedTarget}`. Each entry holds the
    // links that reached the same destination from one source.
    const groups = new Map<string, Link[]>();
    for (const link of ctx.links) {
      const resolved = resolveTargetPath(link, byPath, byName);
      if (!resolved) continue; // unresolved links are broken-ref's concern
      const key = `${link.source}\x00${resolved}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(link);
      else groups.set(key, [link]);
    }

    const issues: Issue[] = [];
    for (const [key, links] of groups) {
      const totalOccurrences = links.reduce((acc, l) => acc + (l.occurrences?.length ?? 1), 0);
      if (totalOccurrences < 2) continue;
      const [source, resolvedTarget] = key.split('\x00') as [string, string];
      const flat = flattenOccurrences(links);
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [source],
        message: tx(TEXTS.message, {
          source,
          resolvedTarget,
          count: flat.length,
          occurrences: flat.map(formatOccurrence).join(TEXTS.occurrenceSeparator),
        }),
        data: {
          target: resolvedTarget,
          resolvedTarget,
          occurrences: flat.map((o) => ({
            kind: o.kind,
            trigger: o.originalTrigger,
            line: o.line ?? null,
            extractor: o.extractor,
          })),
        },
      });
    }
    return issues;
  },
};

interface IFlatOccurrence {
  kind: string;
  originalTrigger: string;
  extractor: string;
  line: number | null;
}

/**
 * Collapse every link's `occurrences[]` into a single chronological
 * list for the warn message. When a link has no `occurrences[]`
 * (legacy emit path), we synthesise one entry from the link's primary
 * `trigger` / `location` so the analyzer still produces a usable
 * message instead of dropping the link.
 */
// eslint-disable-next-line complexity
function flattenOccurrences(links: readonly Link[]): IFlatOccurrence[] {
  const out: IFlatOccurrence[] = [];
  for (const link of links) {
    if (link.occurrences && link.occurrences.length > 0) {
      for (const occ of link.occurrences) {
        out.push({
          kind: link.kind,
          originalTrigger: occ.originalTrigger,
          extractor: occ.extractor,
          line: occ.location?.line ?? null,
        });
      }
      continue;
    }
    // Legacy fallback, the extractor did not populate occurrences[].
    const trigger = link.trigger?.originalTrigger ?? link.target;
    out.push({
      kind: link.kind,
      originalTrigger: trigger,
      extractor: link.sources[0] ?? 'unknown',
      line: link.location?.line ?? null,
    });
  }
  // Stable ordering by line then trigger so the message reads top-to-bottom.
  out.sort((a, b) => {
    const la = a.line ?? Number.MAX_SAFE_INTEGER;
    const lb = b.line ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    return a.originalTrigger.localeCompare(b.originalTrigger);
  });
  return out;
}

function formatOccurrence(occ: IFlatOccurrence): string {
  if (occ.line === null) {
    return tx(TEXTS.occurrenceUnknownLine, { trigger: occ.originalTrigger, kind: occ.kind });
  }
  return tx(TEXTS.occurrence, { trigger: occ.originalTrigger, kind: occ.kind, line: occ.line });
}

/**
 * Map<normalised-name, candidate node paths>. Mirrors what the post-walk
 * `liftResolvedLinkConfidence` builds, but the analyzer constructs its
 * own copy because the resolved-target index is not threaded through
 * the analyzer context. Names come from `frontmatter.name`, filename
 * basename (extension stripped), and dirname; all three run through
 * the same `normalizeTrigger` pipeline as the lift's identifier
 * derivation so the lookup keys agree.
 */
function buildNameIndex(nodes: readonly Node[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const node of nodes) {
    for (const candidate of collectIdentifiers(node)) {
      const normalised = normalizeTrigger(candidate);
      if (!normalised) continue;
      const bucket = out.get(normalised);
      if (bucket) bucket.push(node.path);
      else out.set(normalised, [node.path]);
    }
  }
  return out;
}

// eslint-disable-next-line complexity
function collectIdentifiers(node: Node): string[] {
  const out: string[] = [];
  const fmName = node.frontmatter?.['name'];
  if (typeof fmName === 'string' && fmName.length > 0) out.push(fmName);
  const segs = node.path.split('/');
  const last = segs[segs.length - 1] ?? '';
  if (last) {
    const stem = last.replace(/\.[^.]+$/, '');
    if (stem) out.push(stem);
  }
  if (segs.length >= 2) {
    const dirBase = segs[segs.length - 2];
    if (dirBase) out.push(dirBase);
  }
  return out;
}

/**
 * Path-style target shortcut: `link.target` already IS a node path.
 * Trigger-style targets carry a sigil; strip and look up in the name
 * index. Returns `null` when neither evidence path leads to a real
 * node (the link is broken; `core/broken-ref` flags it separately).
 */
function resolveTargetPath(
  link: Link,
  byPath: Map<string, Node>,
  byName: Map<string, string[]>,
): string | null {
  if (byPath.has(link.target)) return link.target;
  const trigger = link.trigger?.normalizedTrigger;
  if (!trigger) return null;
  const stripped = trigger.replace(/^[/@]/, '').trim();
  if (!stripped) return null;
  const candidates = byName.get(stripped);
  if (!candidates || candidates.length === 0) return null;
  // Multiple candidates can share a name (a `command` and a `skill`
  // both named `deploy`, for instance). For the redundancy check we
  // do not need to disambiguate, ANY single resolution suffices to
  // know that the source has at least one valid edge to that path.
  // The lift transform's strict-kind filter is not relevant here.
  return candidates[0] ?? null;
}

