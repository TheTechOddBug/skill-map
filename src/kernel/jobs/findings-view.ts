/**
 * Findings default-view / bucket-filter semantics (`spec/cli-contract.md`
 * §sm findings), the SINGLE source of the row-visibility rules shared by
 * `sm findings` (`cli/commands/findings.ts`) and the BFF's
 * `GET /api/nodes/:pathB64/findings` (`server/routes/node-findings.ts`).
 *
 * The rules, verbatim from the contract:
 *
 *   - The DEFAULT view shows OPEN rows, `human-decision` rows (the
 *     author's TODO) and STALE rows (the node body changed since the
 *     judgment, or the node left the scan); stale rows ride INLINE
 *     carrying their derived `stale` flag so renderers mark them in
 *     place (user call 2026-07-20: staleness is a per-row annotation,
 *     not a hidden bucket). It hides DISMISSED rows (their class
 *     matches an active sidecar suppression, the operator's explicit
 *     silence) and `fixed` rows (already handled).
 *   - The bucket flags are FILTERS, not additive reveals: `dismissed`
 *     shows ONLY the suppressed bucket, `fixed` ONLY the fixed bucket,
 *     `stale` ONLY the stale rows; together their union. Precedence
 *     `dismissed` > `fixed` > `stale`: a suppressed row counts as
 *     dismissed no matter its resolution or staleness (the operator's
 *     explicit silence is the strongest state), and a fixed+stale row
 *     counts as fixed.
 *   - The excluded-count pair (`dismissedExcluded` / `fixedExcluded`)
 *     is a DEFAULT-view honesty device: what the default view held
 *     back under the same filters, disjointly. Both are 0 whenever a
 *     bucket filter is active (an explicit bucket view holds nothing
 *     back to report).
 *
 * Everything here is pure over already-fetched `IFindingRecord` rows;
 * callers source the list with `includeStale: true` (the adapter hides
 * stale rows by default), supply `isSuppressed` from the node's
 * suppressions (the write-through `scan_nodes.annotations_json` mirror,
 * see `spec/db-schema.md` §state_findings), and partition here.
 */

import type { IFindingRecord } from '../types/storage.js';

/** Per-row suppression test, built by the caller from the node's entries. */
export type TFindingSuppressedTest = (finding: IFindingRecord) => boolean;

/** The bucket-filter flags (`--dismissed` / `--fixed` / `--stale`, `?…=1`). */
export interface IFindingsBucketFlags {
  dismissed: boolean;
  fixed: boolean;
  stale: boolean;
}

/**
 * True when a bucket flag narrows the view to those buckets. A bucket
 * filter omits the default-view rows and turns off the excluded-count
 * reporting (the operator's own narrowing, like `--type`).
 */
export function bucketFilterActive(flags: IFindingsBucketFlags): boolean {
  return flags.dismissed || flags.fixed || flags.stale;
}

/**
 * Row visibility under the given bucket flags:
 *
 *   - suppressed (the read-time dismissal lens): shown ONLY under the
 *     dismissed bucket, no matter its resolution or staleness (the
 *     operator's explicit silence takes precedence over every state).
 *   - `resolution === 'fixed'`: shown ONLY under the fixed bucket, even
 *     when the row also went stale (state precedence).
 *   - otherwise (open, `human-decision`, or stale): a DEFAULT-view row,
 *     stale ones riding inline with their flag; under an explicit
 *     bucket filter only the `stale` flag re-admits them (and only the
 *     stale ones).
 */
export function isFindingShown(
  finding: IFindingRecord,
  flags: IFindingsBucketFlags,
  isSuppressed: TFindingSuppressedTest,
): boolean {
  if (isSuppressed(finding)) return flags.dismissed;
  // Row-grain dismissal (`resolution = 'dismissed'`, 2026-07-22): rides
  // the SAME dismissed bucket as the class suppression; the two hide
  // mechanisms are one concept to the operator.
  if (finding.resolution === 'dismissed') return flags.dismissed;
  if (finding.resolution === 'fixed') return flags.fixed;
  if (bucketFilterActive(flags)) return flags.stale && finding.stale;
  return true;
}

/** Output of {@link partitionFindingsView}. */
export interface IFindingsViewPartition {
  /** Rows the view renders, in the input order. */
  shown: IFindingRecord[];
  /**
   * Rows the DEFAULT view held back (dismissed + fixed). Always EMPTY
   * under an explicit bucket filter: the excluded-count honesty device
   * is a default-view feature only.
   */
  hidden: IFindingRecord[];
}

/**
 * Partition an `includeStale: true` findings list into the rendered rows
 * and the default-view hidden rows. ONE pass over rows the result set
 * already holds, so the hidden breakdown inherits every upstream filter
 * (node, type, severity, extension, since, threshold) for free.
 */
export function partitionFindingsView(
  all: readonly IFindingRecord[],
  flags: IFindingsBucketFlags,
  isSuppressed: TFindingSuppressedTest,
): IFindingsViewPartition {
  const shown = all.filter((f) => isFindingShown(f, flags, isSuppressed));
  const hidden = bucketFilterActive(flags)
    ? []
    : all.filter((f) => !isFindingShown(f, flags, isSuppressed));
  return { shown, hidden };
}

/** Hidden rows silenced by an active suppression (top precedence). */
export function countDismissedHidden(
  hidden: readonly IFindingRecord[],
  isSuppressed: TFindingSuppressedTest,
): number {
  return hidden.filter((f) => isSuppressed(f) || f.resolution === 'dismissed').length;
}

/**
 * Hidden rows a fixer / human moved to `fixed` (and not suppressed): the
 * remainder of the hidden set, since stale rows stopped hiding
 * (2026-07-20) and every hidden row is either dismissed or fixed.
 */
export function countFixedHidden(
  hidden: readonly IFindingRecord[],
  isSuppressed: TFindingSuppressedTest,
): number {
  return hidden.filter(
    (f) => !isSuppressed(f) && f.resolution === 'fixed',
  ).length;
}
