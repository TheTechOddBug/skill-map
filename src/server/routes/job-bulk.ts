/**
 * Bulk queue mutations for the UI queue inspector (`spec/cli-contract.md`
 * §Serve route table):
 *
 *   - `POST /api/jobs/cancel-all` -> `sm jobs cancel --all`
 *   - `POST /api/jobs/prune`      -> clear ALL terminal jobs NOW
 *
 * `cancel-all` rides the SAME adapter primitive as the `--all` verb
 * (`adapter.jobs.cancelAllActive`, `spec/job-lifecycle.md` §Cancellation):
 * every `queued` / `running` job moves to the terminal `cancelled` state in
 * one transaction, and the route broadcasts one canonical `job.cancelled`
 * envelope per affected id (the same flavor the CLI `--all` push leg
 * delivers), so every client updates live. It answers `204 No Content`; the
 * UI drives its confirm + feedback from its own client-side counts.
 *
 * `prune` DIVERGES from the retention-based CLI verb `sm jobs prune` (which
 * keeps `failed` forever): the UI button is an immediate "clear finished",
 * so it prunes every terminal state NOW (cutoff = this instant, inclusive of
 * jobs finished up to now, since `pruneTerminal` uses a strict `<`). It
 * reuses `adapter.jobs.pruneTerminal` per terminal status, which also sweeps
 * orphaned `state_job_contents` in the same transaction. Prune emits NO WS
 * event (silent GC per `spec/job-lifecycle.md` §Retention and GC); the acting
 * client re-fetches, other clients reconcile on their next frame. `204`.
 *
 * Both are WRITE opens (`tryWithSqlite`, no `versionCheck`): a missing DB
 * degrades to a vacuous no-op (`204`, nothing to mutate) and a drifted
 * schema self-refuses with the global `db-drift` envelope. No request body.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import type { WsBroadcaster } from '../broadcaster.js';
import { buildJobCancelledEvent } from '../events.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IServerOptions } from '../options.js';

/** The three terminal states the prune route can clear. */
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/**
 * Narrow deps bag (mirror of `IJobCancelRouteDeps`): bulk mutations over the
 * jobs table need the DB path plus the broadcaster for the per-id fan-out.
 */
export interface IJobBulkRouteDeps {
  options: IServerOptions;
  broadcaster: WsBroadcaster;
}

export function registerJobBulkRoutes(app: Hono, deps: IJobBulkRouteDeps): void {
  // Cancel every active (queued / running) job; one `job.cancelled` per id.
  app.post('/api/jobs/cancel-all', async (c) => {
    const ids = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.jobs.cancelAllActive(Date.now()),
    );
    for (const id of ids ?? []) deps.broadcaster.broadcast(buildJobCancelledEvent(id));
    return c.body(null, 204);
  });

  // Clear terminal jobs now: every terminal state by default, or just the one
  // named by `?status=` (e.g. `failed` for the UI's "clear failed"). `+ 1`
  // makes the adapter's strict `finishedAt < cutoff` inclusive of jobs
  // finished up to this instant. No WS event (silent GC).
  app.post('/api/jobs/prune', async (c) => {
    const statuses = resolvePruneStatuses(c.req.query('status'));
    const cutoff = Date.now() + 1;
    await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        for (const status of statuses) {
          await adapter.jobs.pruneTerminal(status, cutoff);
        }
      },
    );
    return c.body(null, 204);
  });
}

/**
 * Resolve the optional `status` query into the terminal states to prune: an
 * absent / empty param clears all three; a single terminal state clears just
 * that one; any other value (including an active state) is a `400 bad-query`.
 */
function resolvePruneStatuses(raw: string | undefined): readonly TerminalStatus[] {
  const trimmed = raw?.trim();
  if (!trimmed) return TERMINAL_STATUSES;
  if ((TERMINAL_STATUSES as readonly string[]).includes(trimmed)) {
    return [trimmed as TerminalStatus];
  }
  throw new HTTPException(400, {
    message: tx(SERVER_TEXTS.jobsListBadStatus, {
      value: sanitizeForTerminal(trimmed),
      allowed: TERMINAL_STATUSES.join(', '),
    }),
  });
}
