/**
 * `POST /api/jobs/:jobId/cancel`, the HTTP face of `sm jobs cancel <id>`
 * (Step 16, launcher stop; `spec/cli-contract.md` §Serve route table).
 *
 * The inspector's launcher stop/restart affordance needs to resolve a
 * zombie RUNNING job (e.g. a killed agent still holding its claim)
 * without dropping to the CLI. The transition rides the SAME adapter
 * primitive as the verb (`adapter.jobs.cancel`, `spec/job-lifecycle.md`
 * §Cancellation): a `queued` / `running` job moves to the terminal
 * `cancelled` state; cancelling does NOT interrupt any external agent,
 * it discovers the terminal state when its `sm record` callback is
 * refused. Restart is client-side composition: cancel, then the normal
 * `POST /api/nodes/:pathB64/jobs` resubmit.
 *
 * Outcome mapping (the port's `TJobTransitionOutcome` -> HTTP):
 *
 *   - `cancelled`        -> broadcast the canonical `job.cancelled`
 *     envelope (`spec/job-events.md` §`job.cancelled`, the same flavor
 *     the CLI push leg delivers via `POST /api/job-events`) so every
 *     client's launcher resets live, then `204 No Content` (mirror of
 *     the favorites mutations).
 *   - `already-terminal` -> 409 `job-terminal` (`ConflictError`; the
 *     CLI's "already terminal" exit-2 refusal).
 *   - `not-found`        -> 404 `not-found` (the CLI's exit 5). A
 *     missing DB file maps here too (no DB, no such job).
 *
 * The DB open is a WRITE open (`tryWithSqlite`, no `versionCheck`), so
 * a drifted on-disk schema refuses with `DbSchemaDriftError` -> the
 * global `db-drift` envelope. No request body by contract; the only
 * client input is the `:jobId` segment, sanitised before it reaches any
 * error message.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { ConflictError } from '../app.js';
import type { WsBroadcaster } from '../broadcaster.js';
import { buildJobCancelledEvent } from '../events.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IServerOptions } from '../options.js';

/**
 * Deliberately NARROW deps (no `IRouteDeps`): the route touches exactly
 * the jobs table (via `options.dbPath`) and the live push (via
 * `broadcaster`), so the bag physically cannot hand it config or the
 * plugin runtime. Same narrow-bag precedent as `registerJobEventsRoute`.
 */
export interface IJobCancelRouteDeps {
  options: IServerOptions;
  broadcaster: WsBroadcaster;
}

export function registerJobCancelRoute(app: Hono, deps: IJobCancelRouteDeps): void {
  app.post('/api/jobs/:jobId/cancel', async (c) => {
    const jobId = c.req.param('jobId');
    const safeId = sanitizeForTerminal(jobId);
    // Defensive shape gate: the router cannot match an empty segment,
    // but an encoded-whitespace id (`%20`) would reach the adapter as a
    // blank string; refuse it as unknown without querying.
    if (jobId.trim().length === 0) throw jobNotFound(safeId);

    // WRITE open: `tryWithSqlite` short-circuits to `null` on a missing
    // DB file (-> 404 per the contract row) and, having no
    // `versionCheck`, runs the write-side drift refusal
    // (`DbSchemaDriftError` -> the global `db-drift` envelope).
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.jobs.cancel(jobId, Date.now()),
    );
    if (outcome === null || outcome === 'not-found') throw jobNotFound(safeId);
    if (outcome !== 'cancelled') {
      // `already-terminal` (the port's `failed` arm is unreachable from
      // `jobs.cancel`): the job finished before the stop arrived.
      throw new ConflictError({
        code: 'job-terminal',
        message: tx(SERVER_TEXTS.jobCancelAlreadyTerminal, { id: safeId }),
      });
    }

    // After the transition committed (`tryWithSqlite` closed the DB):
    // the id echoed on the envelope matched a real row by construction.
    deps.broadcaster.broadcast(buildJobCancelledEvent(jobId));
    return c.body(null, 204);
  });
}

function jobNotFound(safeId: string): HTTPException {
  return new HTTPException(404, {
    message: tx(SERVER_TEXTS.jobCancelNotFound, { id: safeId }),
  });
}
