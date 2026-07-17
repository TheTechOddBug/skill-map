/**
 * Read-time fold of a node's fresh open probabilistic findings into the
 * aggregate severity chips `core/issue-counter` owns on
 * `card.footer.right` (`warnCount` / `errorCount`). Normative contract:
 * `spec/view-slots.md` §`card.footer.right` ("Aggregate severity chips").
 *
 * `core/issue-counter` still emits the DETERMINISTIC component at scan
 * time (walking the issue accumulator), so `sm scan --json` is unchanged.
 * Findings are recorded post-scan (the queue is async), so their sum can
 * only be added at READ time, when the BFF decorates a node (same
 * lifecycle as the `isFavorite` decoration). This module folds the
 * per-severity finding counts into the node's already-loaded contributions
 * under issue-counter's own registered ids, so the UI renders the summed
 * chip through the standard contribution host with NO UI change.
 *
 * This is NOT the banned host-level chip filter: it does not silence any
 * chip. It ADDS a second real data source (`state_findings`) to the same
 * chip and rewrites its tooltip to break the total down by provenance.
 * Every non-issue-counter contribution passes through untouched, and a
 * severity with zero findings leaves issue-counter's chip (and its
 * tooltip) exactly as emitted.
 */

import type { IPersistedContribution } from '../kernel/ports/storage.js';
import type { IFindingSeverityCount } from '../kernel/types/storage.js';
import { tx } from '../kernel/util/tx.js';
import { CORE_PLUGIN_ID } from '../plugins/ids.js';
import type { TContributionsRegistry } from './envelope.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';

/** The extension id that owns the aggregate chips (built-in `core` plugin). */
const ISSUE_COUNTER_EXTENSION_ID = 'issue-counter';

/**
 * Display cap on a counter chip value (mirrors `issue-counter`'s own
 * `Math.min(count, 99)` scan-time cap). The provenance tooltip reports the
 * TRUE (uncapped) breakdown so a capped chip still explains its sources.
 */
const CHIP_CAP = 99;

/** The two severity tiers, one aggregate chip each. */
interface ITier {
  /** Key into `IFindingSeverityCount`. */
  severityKey: 'warn' | 'error';
  /** issue-counter's contribution id + qualified-id last segment. */
  contributionId: 'warnCount' | 'errorCount';
  /** Chip tint (`NodeCounter` severity palette). */
  chipSeverity: 'warn' | 'danger';
  /** Severity noun leaves for the tooltip (`tx` picks singular / plural). */
  severitySingular: string;
  severityPlural: string;
}

const TIERS: readonly ITier[] = [
  {
    severityKey: 'warn',
    contributionId: 'warnCount',
    chipSeverity: 'warn',
    severitySingular: SERVER_TEXTS.aggregateChipSeverityWarnSingular,
    severityPlural: SERVER_TEXTS.aggregateChipSeverityWarnPlural,
  },
  {
    severityKey: 'error',
    contributionId: 'errorCount',
    chipSeverity: 'danger',
    severitySingular: SERVER_TEXTS.aggregateChipSeverityErrorSingular,
    severityPlural: SERVER_TEXTS.aggregateChipSeverityErrorPlural,
  },
];

/**
 * Fold `findingCounts` into the node's `contributions`. Returns a fresh
 * array; the input is never mutated. When the node has no fresh open
 * findings the contributions are returned as-is.
 */
export function foldFindingsIntoSeverityChips(
  contributions: readonly IPersistedContribution[],
  findingCounts: IFindingSeverityCount,
  registry: TContributionsRegistry,
  nodePath: string,
): IPersistedContribution[] {
  // Fast path: no fresh open findings on this node -> the chips stay
  // exactly as issue-counter emitted them at scan time.
  if (findingCounts.warn === 0 && findingCounts.error === 0) {
    return contributions.slice();
  }
  const matched = new Set<ITier['contributionId']>();
  const out = contributions.map((c) => {
    const tier = tierFor(c);
    if (!tier) return c; // non-issue-counter contribution: untouched passthrough.
    const count = findingCounts[tier.severityKey];
    if (count <= 0) return c; // no findings for this severity: leave as emitted.
    matched.add(tier.contributionId);
    return combineChip(c, tier, count);
  });
  // Severities with findings but no deterministic chip to combine into:
  // synthesize a chip under issue-counter's id so the finding still shows.
  for (const tier of TIERS) {
    const count = findingCounts[tier.severityKey];
    if (count <= 0 || matched.has(tier.contributionId)) continue;
    const synthesized = synthesizeChip(tier, count, registry, nodePath);
    if (synthesized) out.push(synthesized);
  }
  return out;
}

/** The tier a contribution belongs to, or `null` when it is not an issue-counter chip. */
function tierFor(c: IPersistedContribution): ITier | null {
  if (c.pluginId !== CORE_PLUGIN_ID || c.extensionId !== ISSUE_COUNTER_EXTENSION_ID) {
    return null;
  }
  return TIERS.find((t) => t.contributionId === c.contributionId) ?? null;
}

/** Combine the deterministic chip with the finding count (capped value + provenance tooltip). */
function combineChip(
  existing: IPersistedContribution,
  tier: ITier,
  findingCount: number,
): IPersistedContribution {
  const deterministic = readCounterValue(existing.payload);
  const base = isRecord(existing.payload) ? existing.payload : {};
  return {
    ...existing,
    payload: {
      ...base,
      value: Math.min(deterministic + findingCount, CHIP_CAP),
      severity: tier.chipSeverity,
      tooltip: buildTooltip(tier, deterministic, findingCount),
    },
  };
}

/** Synthesize an issue-counter chip for a findings-only severity (no deterministic component). */
function synthesizeChip(
  tier: ITier,
  findingCount: number,
  registry: TContributionsRegistry,
  nodePath: string,
): IPersistedContribution | null {
  const qualifiedId = `${CORE_PLUGIN_ID}/${ISSUE_COUNTER_EXTENSION_ID}/${tier.contributionId}`;
  const entry = registry[qualifiedId];
  // issue-counter not registered (its plugin disabled): there is no host
  // slot to render into, so there is nothing to synthesize.
  if (!entry) return null;
  return {
    pluginId: CORE_PLUGIN_ID,
    extensionId: ISSUE_COUNTER_EXTENSION_ID,
    contributionId: tier.contributionId,
    nodePath,
    slot: entry.slot,
    payload: {
      value: Math.min(findingCount, CHIP_CAP),
      severity: tier.chipSeverity,
      tooltip: buildTooltip(tier, 0, findingCount),
    },
    // Read-time synthesis, not a persisted scan emission. The card slot
    // orders by the registry `priority`, not `emittedAt`, so 0 is inert.
    emittedAt: 0,
  };
}

/**
 * Provenance breakdown, e.g. "3 warnings: 2 checks + 1 AI finding". `total`
 * is the TRUE sum (uncapped) so a chip capped at 99 still explains its
 * sources honestly.
 */
function buildTooltip(tier: ITier, checks: number, ai: number): string {
  const total = checks + ai;
  return tx(SERVER_TEXTS.aggregateChipTooltip, {
    total,
    severity: pick(total, tier.severitySingular, tier.severityPlural),
    checks: tx(
      pick(checks, SERVER_TEXTS.aggregateChipChecksSingular, SERVER_TEXTS.aggregateChipChecksPlural),
      { count: checks },
    ),
    ai: tx(
      pick(ai, SERVER_TEXTS.aggregateChipAiSingular, SERVER_TEXTS.aggregateChipAiPlural),
      { count: ai },
    ),
  });
}

/** English count agreement: exactly 1 is singular, everything else (incl. 0) plural. */
function pick(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** Read the non-negative numeric `value` off a persisted counter payload; 0 when absent / off-shape. */
function readCounterValue(payload: unknown): number {
  if (isRecord(payload)) {
    const v = payload['value'];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}
