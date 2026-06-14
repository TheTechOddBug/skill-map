/**
 * `reference-redundant` rule. Flags every (source, resolved-target)
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
 *   1. For each link, read `link.resolvedTarget`, the path the post-walk
 *      lift already resolved the edge to (path-style targets and trigger-
 *      style `@foo` / `/foo` resolved through the kind/lens matrix plus
 *      the filename / dirname identifiers all land there). Links the lift
 *      left unresolved carry no `resolvedTarget` and are skipped,
 *      `core/reference-broken` flags those. Reading the lift's result
 *      instead of re-deriving a name index keeps grouping in lock-step
 *      with the resolved graph; a trigger that matches a name but fails
 *      the strict kind matrix is deliberately NOT grouped here, that kind
 *      mismatch is `core/link-conflict`'s concern.
 *   2. Group links by `(source, resolvedTarget)`.
 *   3. Sum the `occurrences[]` lengths across every link in the group.
 *      A group with `total >= 2` emits one info issue on the source.
 *      Message shape (compact finding grammar, subject first):
 *      `<resolvedTarget>:\nDuplicate reference (2): \`refs/x.md\`
 *      (124, 145).`, occurrences grouped by trigger with their line
 *      numbers collapsed.
 *
 * Why occurrences sum (not edge count) drives detection: extractor-level
 * dedup collapses repeated same-form sites (e.g. `@./foo.md` twice in
 * the same body emits one Link with one occurrence today, the
 * within-extractor dedup eats the duplicate). Once that lid is lifted,
 * `occurrences.length >= 2` on a single edge also fires the rule.
 * Today the typical case is two extractors converging on one edge
 * (`sources.length === 2`, `occurrences.length === 2`).
 *
 * Severity is `info` (downgraded from `warn`): a multi-form reference
 * is a consolidation hint, not a defect, nothing breaks at runtime and
 * keeping both forms can be deliberate. `warn` put it in the same
 * visual bucket as genuinely actionable issues (`reference-broken`,
 * `name-reserved`) and inflated the per-card warning chips. Mitigation
 * is operator-driven (delete the redundant occurrence(s) or keep them
 * deliberately), no autofix ships today.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Link } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { REFERENCE_REDUNDANT_TEXTS as TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'reference-redundant';

export const referenceRedundantAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags when one node references the same target through two or more different links (e.g. a markdown link plus a `references:` entry).',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    if (ctx.links.length === 0) return [];

    // Group key: `${source}\x00${resolvedTarget}`. Each entry holds the
    // links that reached the same destination from one source.
    const groups = new Map<string, Link[]>();
    for (const link of ctx.links) {
      const resolved = link.resolvedTarget;
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
        severity: 'info',
        nodeIds: [source],
        message: formatFinding({
          subject: resolvedTarget,
          body: tx(TEXTS.message, {
            count: flat.length,
            occurrences: formatGroupedOccurrences(flat),
          }),
        }),
        fix: { summary: tx(TEXTS.fixSummary) },
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
 * list for the issue message. When a link has no `occurrences[]`
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

/**
 * Group the chronological occurrence list BY TRIGGER text: each
 * distinct trigger renders once with its line numbers collapsed into a
 * single paren list (`` `refs/x.md` (124, 145) ``). Insertion order
 * follows each trigger's first appearance (the flat list is already
 * line-sorted), and an occurrence without a recorded line contributes
 * the `lineUnknown` placeholder.
 */
function formatGroupedOccurrences(occurrences: readonly IFlatOccurrence[]): string {
  const byTrigger = new Map<string, IFlatOccurrence[]>();
  for (const occ of occurrences) {
    const bucket = byTrigger.get(occ.originalTrigger);
    if (bucket) bucket.push(occ);
    else byTrigger.set(occ.originalTrigger, [occ]);
  }
  return [...byTrigger.entries()]
    .map(([trigger, occs]) =>
      tx(TEXTS.occurrence, {
        trigger,
        lines: occs
          .map((o) => (o.line === null ? TEXTS.lineUnknown : String(o.line)))
          .join(', '),
      }),
    )
    .join(TEXTS.occurrenceSeparator);
}


