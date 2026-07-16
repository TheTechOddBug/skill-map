/**
 * Reads a node's ACTIVE finding suppressions from its `.sm` sidecar, the
 * projection both suppression-aware surfaces share:
 *
 *   - `sm record` (`commands/record-outcome.ts`), the finder-lane filter:
 *     matching findings are dropped before they land in `state_findings`
 *     (`spec/db-schema.md` §state_findings, finder-lane suppression filter).
 *   - `sm jobs submit` (`commands/job-queue.ts`), the suppressed-judgment
 *     advisory: a finder submit over a node with a matching suppression
 *     warns the operator BEFORE the agent pass is spent
 *     (`spec/job-lifecycle.md` §Submit, suppressed-judgment advisory).
 *
 * The sidecar is the source of truth (`sm findings dismiss` writes it
 * directly through the gated channel), NOT the denormalized
 * `scan_nodes.annotations_json`, which is stale between a dismiss and the
 * next scan. An absent / invalid sidecar, or a missing / non-array
 * `suppressions`, yields no matches.
 */

import { resolve } from 'node:path';

import type { ISuppressionMatch } from '../../kernel/jobs/index.js';
import { readSidecarFor } from '../../kernel/sidecar/index.js';

/**
 * Read the node's LIVE `.sm` sidecar and project its
 * `annotations.suppressions` to the finder-lane match shape. Each entry
 * keeps its optional `type` (absent = every type from the finder); entries
 * with no string `extension` are skipped (defensive, AJV pins the shape on
 * the write side).
 */
export function readActiveSuppressions(cwd: string, nodeId: string): ISuppressionMatch[] {
  const raw = readSidecarFor(resolve(cwd, nodeId)).parsed?.annotations?.['suppressions'];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toSuppressionMatch)
    .filter((m): m is ISuppressionMatch => m !== null);
}

/**
 * Narrow one raw `suppressions[]` entry to a finder-lane match, or `null`
 * when it lacks a string `extension` (defensive: AJV pins the shape on the
 * write side). Keeps the optional `type` (absent = every type).
 */
function toSuppressionMatch(entry: unknown): ISuppressionMatch | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const extension = record['extension'];
  if (typeof extension !== 'string' || extension.length === 0) return null;
  const type = record['type'];
  return typeof type === 'string' ? { extension, type } : { extension };
}
