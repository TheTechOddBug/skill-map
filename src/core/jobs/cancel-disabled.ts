/**
 * Disable cascade over the job queue (`spec/job-lifecycle.md`
 * §Cancellation, user decision 2026-07-21: active cancellation).
 *
 * When an extension is disabled, its `queued` jobs are cancelled through
 * the same primitive as `sm jobs cancel`. This helper is the shared DB
 * leg used by BOTH toggle surfaces (`sm plugins disable` and the
 * `PATCH /api/plugins[...]` routes): it matches and transitions the
 * rows and returns the affected ids; the CALLER owns the channel-specific
 * follow-ups (the `job.cancelled` live push / WS broadcast and the
 * aggregated operations-log line), because those differ between the CLI
 * and the BFF.
 *
 * Matching: a key is either a qualified `<plugin>/<ext>` id (exact match
 * on the job's `extension_id`) or a bare plugin id (matches every
 * extension of that plugin by `<plugin>/` prefix). In practice both
 * surfaces expand bundles to qualified ids before persisting, the bare
 * form is defensive symmetry with `toEnableConfigKey`.
 *
 * `running` jobs are deliberately NOT touched: the processing agent
 * already claimed the work, its record still lands, and the record-side
 * write-throughs independently degrade to history-only while the
 * extension is disabled.
 */

import type { StoragePort } from '../../kernel/ports/storage.js';

/**
 * Cancel every `queued` job whose extension matches one of `keys`.
 * Returns the cancelled job ids (empty when nothing matched). Callers
 * with no matching jobs get a clean no-op: nothing to push, nothing to
 * log.
 */
export async function cancelQueuedJobsForKeys(
  adapter: StoragePort,
  keys: readonly string[],
  nowMs: number,
): Promise<string[]> {
  if (keys.length === 0) return [];
  const queued = await adapter.jobs.list({ status: 'queued' });
  const cancelled: string[] = [];
  for (const job of queued) {
    if (!matchesAnyKey(job.extensionId, keys)) continue;
    const outcome = await adapter.jobs.cancel(job.id, nowMs);
    // `already-terminal` / `not-found` can only race a concurrent
    // mutation between the list and the transition; either way the job
    // is no longer queued, which is the goal, so only real transitions
    // are reported.
    if (outcome === 'cancelled') cancelled.push(job.id);
  }
  return cancelled;
}

/** Exact qualified match, or `<plugin>/` prefix match for a bare key. */
function matchesAnyKey(extensionId: string, keys: readonly string[]): boolean {
  return keys.some((key) =>
    key.includes('/') ? extensionId === key : extensionId.startsWith(`${key}/`),
  );
}
