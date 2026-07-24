/**
 * `GET /api/jobs?status=&extension=&node=`, the cross-corpus job list
 * (`spec/cli-contract.md` §Serve route table). The read side of the coming
 * UI queue inspector: unlike `GET /api/nodes/:pathB64/prob-extensions`
 * (per-node launcher state), this lists every job across the corpus EXCEPT
 * jobs from host-locked system extensions (the `ai-ping-action` liveness
 * probe), which stay hidden like they do on every other discovery surface.
 * Otherwise the HTTP face of `sm jobs list` (which, being a power-user
 * surface, still shows them).
 *
 * Thin HTTP wrapper over the existing kernel primitive
 * `adapter.jobs.list(filter)` (newest-first, `createdAt DESC, id DESC`); no
 * queue logic lives here. The three optional query params map 1:1 onto
 * `IJobListFilter` (`status` / `extensionId` / `nodeId`); an absent or
 * empty param is dropped so the filter matches every job. `extension`
 * matches the stored qualified id exactly OR by bare-id suffix, same as the
 * CLI verb (`--extension skill-summarizer` finds `core/skill-summarizer`).
 *
 * READ open: `tryWithSqlite` short-circuits to `null` on a missing DB file
 * (-> empty list, the read-side degrade every GET route shares) and threads
 * `bffReadVersionCheck()` so a drifted / older DB WARNS to the server log
 * and proceeds instead of refusing (the `db-drift` envelope is reserved for
 * mutating routes). Deliberately NARROW deps (`options` only, no
 * `IRouteDeps`): the route touches exactly the jobs table, so the bag
 * physically cannot hand it config, the registries, or the plugin runtime,
 * same narrow-bag precedent as `registerJobCancelRoute`.
 *
 * Projection: every row is serialised through the shared `toPublicJob`
 * (`Omit<Job, 'nonce'>`), so the `nonce` record credential NEVER reaches a
 * read surface (`spec/job-lifecycle.md` §Atomic claim · Nonce exposure; a
 * passive reader must not be able to forge `sm record` callbacks). The
 * response rides a registry-less `kind: 'jobs'` list envelope
 * (`rest-envelope.schema.json`).
 *
 * The only 400 the route can raise: an unknown `status` value (not one of
 * the five `JobStatus` states) throws `HTTPException(400)` -> the global
 * `onError`'s `bad-query` envelope. `extension` / `node` accept any string
 * (a non-matching filter simply returns zero rows).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { JobStatus } from '../../kernel/types.js';
import type { IJobListFilter } from '../../kernel/types/storage.js';
import { toPublicJob } from '../../kernel/jobs/index.js';
import { isLockedBuiltIn } from '../../plugins/locked-built-ins.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { buildJobsEnvelope } from '../envelope.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IServerOptions } from '../options.js';

/** The closed set of lifecycle states a `status` filter may name. */
const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
];

/**
 * Narrow deps bag (mirror of `IJobCancelRouteDeps`): a read over the jobs
 * table needs only the DB path. No broadcaster, no registries, no config.
 */
export interface IJobsRouteDeps {
  options: IServerOptions;
}

export function registerJobsRoute(app: Hono, deps: IJobsRouteDeps): void {
  app.get('/api/jobs', async (c) => {
    const { filter, echo } = parseJobsQuery(c.req.query());
    // READ open: `null` on a missing DB (degrade to empty list), version
    // check advises instead of refusing on drift.
    const jobs = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      (adapter) => adapter.jobs.list(filter),
    );
    // Hide jobs from host-locked SYSTEM extensions (e.g. the
    // `core/ai-ping-action` liveness probe): they are internal infra, kept
    // off this discovery surface exactly as `locked` strips them from the
    // Settings plugin list and MCP `list_extensions`. Stored `extensionId`
    // is the qualified id, which is what `isLockedBuiltIn` matches. Then
    // strip the nonce off every remaining row before it leaves the process.
    const items = (jobs ?? [])
      .filter((job) => !isLockedBuiltIn(job.extensionId))
      .map(toPublicJob);
    return c.json(buildJobsEnvelope(items, echo));
  });
}

/**
 * Parse the route's query bag into the storage-layer filter + the
 * envelope-echo. Lives at module scope so the handler stays under the
 * per-function complexity budget. An absent OR empty/whitespace-only param
 * is treated as unset (matches every job), consistent with how the other
 * list routes treat empty filters; only a NON-empty unknown `status`
 * rejects.
 */
function parseJobsQuery(query: Record<string, string | undefined>): {
  filter: IJobListFilter;
  echo: Record<string, unknown>;
} {
  const status = normalize(query['status']);
  const extension = normalize(query['extension']);
  const node = normalize(query['node']);
  assertKnownStatus(status);

  const filter: IJobListFilter = {};
  if (status !== undefined) filter.status = status as JobStatus;
  if (extension !== undefined) filter.extensionId = extension;
  if (node !== undefined) filter.nodeId = node;

  return {
    filter,
    echo: {
      status: status ?? null,
      extension: extension ?? null,
      node: node ?? null,
    },
  };
}

/** Reject a NON-empty `status` filter that names no known lifecycle state. */
function assertKnownStatus(status: string | undefined): void {
  if (status === undefined || JOB_STATUSES.includes(status as JobStatus)) return;
  throw new HTTPException(400, {
    message: tx(SERVER_TEXTS.jobsListBadStatus, {
      value: sanitizeForTerminal(status),
      allowed: JOB_STATUSES.join(', '),
    }),
  });
}

/** Trim a raw query value; `undefined` when absent or empty after trimming. */
function normalize(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
