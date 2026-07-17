/**
 * Findings default-view / bucket-filter semantics (`spec/cli-contract.md`
 * §sm findings), the SINGLE source of the row-visibility rules shared by
 * `sm findings` (`cli/commands/findings.ts`) and the BFF's
 * `GET /api/nodes/:pathB64/findings` (`server/routes/node-findings.ts`).
 *
 * The rules, verbatim from the contract:
 *
 *   - The DEFAULT view shows the needs-attention rows: OPEN rows plus
 *     non-stale `human-decision` rows (the author's TODO). It hides
 *     `fixed` rows (already handled) and stale rows (the node body
 *     changed since the judgment, or the node left the scan).
 *   - The bucket flags are FILTERS, not additive reveals: `fixed` shows
 *     ONLY the fixed bucket, `stale` ONLY the stale bucket, together
 *     their union. `fixed` takes precedence: a row that is BOTH fixed
 *     and stale counts as fixed (state precedence).
 *   - The excluded-count pair (`fixedExcluded` / `staleExcluded`) is a
 *     DEFAULT-view honesty device: what the default view held back under
 *     the same filters, disjointly. Both are 0 whenever a bucket filter
 *     is active (an explicit bucket view holds nothing back to report).
 *
 * Everything here is pure over already-fetched `IFindingRecord` rows;
 * callers source the list with `includeStale: true` (the adapter hides
 * stale rows by default) and partition here.
 */

import type { IFindingRecord } from '../types/storage.js';

/** The two bucket-filter flags (`--fixed` / `--stale`, `?fixed=1` / `?stale=1`). */
export interface IFindingsBucketFlags {
  fixed: boolean;
  stale: boolean;
}

/**
 * True when `fixed` and/or `stale` narrows the view to those buckets. A
 * bucket filter omits the needs-attention rows and turns off the
 * excluded-count reporting (the operator's own narrowing, like `--type`).
 */
export function bucketFilterActive(flags: IFindingsBucketFlags): boolean {
  return flags.fixed || flags.stale;
}

/**
 * Row visibility under the given bucket flags:
 *
 *   - `resolution === 'fixed'`: shown ONLY under the fixed bucket, even
 *     when the row also went stale (state precedence).
 *   - not fixed but `stale`: shown ONLY under the stale bucket. Covers
 *     open-stale AND human-decision-stale rows.
 *   - otherwise (open or non-stale `human-decision`): a needs-attention
 *     row, shown in the DEFAULT view, omitted once an explicit bucket
 *     filter narrows the view to its buckets.
 */
export function isFindingShown(
  finding: IFindingRecord,
  flags: IFindingsBucketFlags,
): boolean {
  if (finding.resolution === 'fixed') return flags.fixed;
  if (finding.stale) return flags.stale;
  return !bucketFilterActive(flags);
}

/** Output of {@link partitionFindingsView}. */
export interface IFindingsViewPartition {
  /** Rows the view renders, in the input order. */
  shown: IFindingRecord[];
  /**
   * Rows the DEFAULT view held back (fixed + stale). Always EMPTY under
   * an explicit bucket filter: the excluded-count honesty device is a
   * default-view feature only.
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
): IFindingsViewPartition {
  const shown = all.filter((f) => isFindingShown(f, flags));
  const hidden = bucketFilterActive(flags) ? [] : all.filter((f) => !isFindingShown(f, flags));
  return { shown, hidden };
}

/** Hidden rows a fixer / human moved to `fixed` (state precedence over stale). */
export function countFixedHidden(hidden: readonly IFindingRecord[]): number {
  return hidden.filter((f) => f.resolution === 'fixed').length;
}

/**
 * Hidden rows held back for staleness (everything hidden that is NOT
 * fixed): a hidden row is either fixed-hidden or stale-hidden, disjointly,
 * so the stale bucket is the complement of the fixed one.
 */
export function countStaleHidden(hidden: readonly IFindingRecord[]): number {
  return hidden.length - countFixedHidden(hidden);
}
