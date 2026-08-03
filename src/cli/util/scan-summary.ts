/**
 * The human-mode scan summary block, shared by every verb that finishes
 * a scan (`context/cli-output-style.md` §Layout patterns):
 *
 * ```
 *      9 nodes · 9 links · 1 error · 1 warning   in 261ms
 *      .skill-map/skill-map.db
 * ```
 *
 * Lives here rather than inside `commands/scan.ts` because `sm init`
 * (and therefore the bare `sm` bootstrap, which delegates to it) runs a
 * first scan too, and its outcome is the same information. It used to
 * print its own one-line variant (`✕ First scan: 9 nodes, 9 links, 2
 * issues.`), which meant the operator's very first look at a scan
 * result was in a format they would never see again, with a red ✕ that
 * read as "the scan failed" when it only meant "some issues are at
 * error severity". One renderer, one shape.
 *
 * Returns LINES rather than printing: the two callers write on
 * different channels (`sm scan` puts the summary on stdout as the
 * verb's result, `sm init` on stderr as progress narration), and that
 * distinction belongs to the caller, not here.
 */

import { tx } from '../../kernel/util/tx.js';
import type { ScanResult } from '../../kernel/index.js';
import { SCAN_TEXTS } from '../i18n/scan.texts.js';
import type { IAnsi } from './ansi.js';
import { relativeIfBelow } from './path-display.js';

export interface ISeverityCounts {
  readonly errors: number;
  readonly warns: number;
  readonly info: number;
}

/**
 * Count DISTINCT nodes affected per severity tier. Same semantics as
 * the UI severity palette: an issue with `nodeIds: [a, b]` contributes
 * `a` and `b` to its tier set, but a tier that already saw `a` from a
 * sibling issue does not double-count. Operators reading both the CLI
 * row and the UI badge therefore see matching numbers (otherwise the
 * UI's "nodes affected" total reads as wrong against the CLI's raw
 * issue-record total).
 */
export function countBySeverity(
  issues: readonly { severity: string; nodeIds?: readonly string[] }[],
): ISeverityCounts {
  const buckets: Record<'error' | 'warn' | 'info', Set<string>> = {
    error: new Set(),
    warn: new Set(),
    info: new Set(),
  };
  for (const i of issues) {
    const tier = i.severity as 'error' | 'warn' | 'info';
    const bucket = buckets[tier];
    if (!bucket) continue;
    fillSeverityBucket(bucket, i.nodeIds);
  }
  return { errors: buckets.error.size, warns: buckets.warn.size, info: buckets.info.size };
}

function fillSeverityBucket(bucket: Set<string>, nodeIds: readonly string[] | undefined): void {
  const ids = nodeIds ?? [];
  // Issues with no `nodeIds` (project-level findings, would be rare
  // but the schema allows it) count once against the tier under a
  // synthetic key so the row still surfaces them.
  if (ids.length === 0) {
    bucket.add('');
    return;
  }
  for (const id of ids) bucket.add(id);
}

/**
 * Format the dot-separated `N nodes · M links · <severity breakdown>`
 * counts block. The breakdown splits issues per severity (`errors`,
 * `warns`, `info`), each coloured to its tier (red / yellow / dim) so
 * the operator can read at a glance "how many are blocking vs noise".
 * Tiers with zero count collapse out, an all-clean scan renders the
 * collapsed `0 issues` placeholder dimmed. Nodes and links stay plain,
 * they're routine output, not signals.
 */
export function formatScanCounts(opts: {
  nodes: number;
  links: number;
  severities: ISeverityCounts;
  ansi: IAnsi;
}): string {
  const { nodes, links, severities, ansi } = opts;
  const parts: string[] = [
    `${nodes} ${countNoun(nodes, SCAN_TEXTS.countNodeNounSingular, SCAN_TEXTS.countNodeNounPlural)}`,
    `${links} ${countNoun(links, SCAN_TEXTS.countLinkNounSingular, SCAN_TEXTS.countLinkNounPlural)}`,
  ];
  const total = severities.errors + severities.warns + severities.info;
  if (total === 0) {
    parts.push(ansi.dim(SCAN_TEXTS.countNoIssues));
  } else {
    if (severities.errors > 0) {
      const noun = countNoun(severities.errors, SCAN_TEXTS.countErrorNounSingular, SCAN_TEXTS.countErrorNounPlural);
      parts.push(ansi.red(`${severities.errors} ${noun}`));
    }
    if (severities.warns > 0) {
      const noun = countNoun(severities.warns, SCAN_TEXTS.countWarningNounSingular, SCAN_TEXTS.countWarningNounPlural);
      parts.push(ansi.yellow(`${severities.warns} ${noun}`));
    }
    if (severities.info > 0) {
      // `info` is an uncountable noun in English (no `infos`), keep it
      // bare so the row reads naturally even at higher counts.
      parts.push(ansi.dim(`${severities.info} ${SCAN_TEXTS.countInfoNoun}`));
    }
  }
  return parts.join(' · ');
}

/**
 * Pick the singular or plural catalog noun for `count` (English plural
 * rule). Extracted so the per-count ternary lives outside
 * `formatScanCounts` (keeps its cyclomatic complexity inside budget),
 * replacing the former `${word}s` hand-suffix helper.
 */
function countNoun(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * The whole block, ready to print: the counts row plus (when the scan
 * persisted) the database path.
 *
 * Glyph policy, unchanged from the shape `sm scan` shipped: success
 * keeps the green ✓ as a positive signal, while a scan carrying
 * error-severity issues drops the glyph entirely (a bare space holds
 * the column so the row still aligns). The per-tier `4 errors` in red
 * is signal enough; doubling it with a leading red ✕ reads as visual
 * noise without adding actionable information.
 *
 * `persistedTo` omits the second line when null (a dry run, or a scan
 * that did not write). `dbPathIfNotPersisted` renders the "would
 * persist to" variant instead, for `--dry-run`.
 */
export function renderScanSummaryLines(opts: {
  result: ScanResult;
  /** Where the scan persisted, or null when it did not. */
  persistedTo: string | null;
  /** Rendered as "would persist" when `persistedTo` is null. */
  dbPathIfNotPersisted?: string;
  /** Paths print relative to this root when they sit below it. */
  cwd: string;
  ansi: IAnsi;
}): string[] {
  const { result, persistedTo, dbPathIfNotPersisted, cwd, ansi } = opts;
  const hasErrors = result.issues.some((i) => i.severity === 'error');
  const glyph = hasErrors ? ' ' : ansi.green('✓');
  const counts = formatScanCounts({
    nodes: result.stats.nodesCount,
    links: result.stats.linksCount,
    severities: countBySeverity(result.issues),
    ansi,
  });
  const duration = ansi.dim(`in ${result.stats.durationMs}ms`);
  const rootsSuffix =
    result.roots.length > 1 ? ansi.dim(`  (${result.roots.length} roots)`) : '';

  const lines = [tx(SCAN_TEXTS.scannedSummary, { glyph, counts, duration, rootsSuffix })];
  if (persistedTo !== null) {
    lines.push(
      tx(SCAN_TEXTS.persistedTo, { dbPath: ansi.dim(relativeIfBelow(persistedTo, cwd)) }),
    );
  } else if (dbPathIfNotPersisted !== undefined) {
    lines.push(
      tx(SCAN_TEXTS.wouldPersist, {
        dbPath: ansi.dim(relativeIfBelow(dbPathIfNotPersisted, cwd)),
      }),
    );
  }
  return lines;
}
