/**
 * Reads a node's ACTIVE finding suppressions from its LIVE `.sm` sidecar.
 *
 * Single consumer: `sm jobs submit` (`commands/job-queue.ts`), the
 * suppressed-judgment advisory: a finder submit over a node with a
 * matching suppression warns the operator BEFORE the agent pass is spent
 * (`spec/job-lifecycle.md` §Submit, suppressed-judgment advisory). One
 * node, one file read, so the live file is fine here; every N-node read
 * surface (the findings view, the card counters,
 * `sm findings suppressions`) instead reads the write-through
 * `scan_nodes.annotations_json` mirror through
 * `adapter.findings.suppressionsByPath` (`spec/db-schema.md`
 * §state_findings, read-time suppression lens).
 */

import { resolve } from 'node:path';

import { suppressionsFromAnnotations, type ISuppressionMatch } from '../../kernel/jobs/index.js';
import { readSidecarFor } from '../../kernel/sidecar/index.js';

/**
 * Read the node's LIVE `.sm` sidecar and project its
 * `annotations.suppressions` to the match shape. Each entry keeps its
 * optional `type` (absent = every type from the finder); entries with no
 * string `extension` are skipped (defensive, AJV pins the shape on the
 * write side).
 */
export function readActiveSuppressions(cwd: string, nodeId: string): ISuppressionMatch[] {
  return suppressionsFromAnnotations(readSidecarFor(resolve(cwd, nodeId)).parsed?.annotations);
}
