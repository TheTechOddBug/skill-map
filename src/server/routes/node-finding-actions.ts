/**
 * Per-finding mutation routes for the inspector's findings tray
 * (`spec/cli-contract.md` §Serve route table):
 *
 *   - `POST /api/nodes/:pathB64/findings/:id/dismiss`  -> `sm findings dismiss`
 *   - `POST /api/nodes/:pathB64/findings/:id/resolve`  -> `sm findings resolve`
 *   - `POST /api/nodes/:pathB64/findings/undismiss`    -> `sm findings undismiss`
 *   - `DELETE /api/nodes/:pathB64/findings/:id`        -> per-row hard delete
 *
 * Dismiss / undismiss are SIDECAR writes riding the same gated channel as
 * the action-dispatch routes: `FilesystemSidecarStore(ensureSidecarWritesAllowed)`
 * threaded with the body's `confirm` / `always`; a missing standing consent
 * surfaces as the global `412` `confirm-required` envelope
 * (`details.key = 'allowEditSmFiles'`), which the UI consent dialog answers
 * by retrying with `confirm` / `always` (an `always` grant persists and the
 * config cache is reloaded, mirror of `POST /api/actions/:id`). Both refresh
 * the write-through `scan_nodes.annotations_json` mirror, read-time lens
 * semantics (`spec/db-schema.md` §state_findings): dismiss deletes NOTHING
 * (the class hides), undismiss makes the stored rows visible instantly, and
 * the undismiss no-match path SELF-HEALS the mirror before its 404.
 *
 * Resolve is a plain DB row-state flip (`resolution = 'fixed'`,
 * `resolution_actor = 'human'`), no sidecar, no consent.
 *
 * Delete hard-removes ONE row (the per-row twin of `sm findings clear`,
 * the inspector's delete X on a revealed dismissed / fixed row): all
 * origins deletable. Deleting the LAST row of a dismissed class also
 * lifts its exact suppression entry (else a later finder run re-finds
 * the class already hidden), which makes THAT case ride the same gated
 * sidecar channel; a plain (fixed / undismissed) delete touches no
 * sidecar and needs no consent (spec §Serve route table).
 *
 * All four answer `204 No Content` on success; the client re-fetches the
 * tray (no WS frame fires for sidecar / row-state writes).
 */

import { resolve } from 'node:path';

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { ensureSidecarWritesAllowed } from '../../core/config/sidecar-consent.js';
import { appendOperation } from '../../core/operations-log.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { IFindingRecord } from '../../kernel/types/storage.js';
import {
  buildSuppressionEntry,
  existingSuppressions,
  mergeSuppression,
  normalizeSuppressionType,
  readSidecarFor,
  sidecarPathFor,
} from '../../kernel/sidecar/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { ConflictError } from '../app.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';
import { decodePathB64Or404 } from './node-loader.js';

/**
 * Narrow bag: the routes touch the findings / scan tables (`options.dbPath`),
 * the project tree for the sidecar write (`runtimeContext.cwd`), and the
 * config cache reload after a persisted `always` grant (`configService`).
 */
export type TFindingActionsRouteDeps = Pick<
  IRouteDeps,
  'options' | 'configService' | 'runtimeContext'
>;

interface IDismissBody {
  /**
   * `true` = the DURABLE class suppression (sidecar write, consent
   * gated). Absent/false = the ROW-grain dismissal (resolution state,
   * no consent), the default since 2026-07-22.
   */
  class?: boolean;
  confirm?: boolean;
  always?: boolean;
}

interface IResolveBody {
  note?: string;
}

interface IUndismissBody {
  extension: string;
  type?: string;
  confirm?: boolean;
  always?: boolean;
}

const CONSENT_PROPS = {
  confirm: { type: 'boolean' },
  always: { type: 'boolean' },
} as const;

/** Shared AJV-message table (mirror of the actions route's tone). */
const BODY_MESSAGES = {
  notJson: SERVER_TEXTS.findingBodyNotJson,
  notObject: SERVER_TEXTS.findingBodyNotObject,
  invalid: SERVER_TEXTS.findingBodyNotObject,
} as const;

const parseDismissBody = makeBodyValidator<IDismissBody>(
  {
    type: 'object',
    properties: { ...CONSENT_PROPS, class: { type: 'boolean' } },
    additionalProperties: false,
  },
  BODY_MESSAGES,
);

/**
 * Same consent-flags shape as dismiss, but the body is OPTIONAL: a bare
 * DELETE (no suppression to lift, or a curl without a payload) parses
 * as `{}` instead of a 400.
 */
const parseDeleteBody = makeBodyValidator<IDismissBody>(
  {
    type: 'object',
    properties: { ...CONSENT_PROPS },
    additionalProperties: false,
  },
  BODY_MESSAGES,
  { emptyAs: {} },
);

const parseResolveBody = makeBodyValidator<IResolveBody>(
  {
    type: 'object',
    properties: { note: { type: 'string' } },
    additionalProperties: false,
  },
  BODY_MESSAGES,
);

const parseUndismissBody = makeBodyValidator<IUndismissBody>(
  {
    type: 'object',
    required: ['extension'],
    properties: {
      extension: { type: 'string', minLength: 1 },
      type: { type: 'string' },
      ...CONSENT_PROPS,
    },
    additionalProperties: false,
  },
  {
    ...BODY_MESSAGES,
    mapping: {
      '/extension:required': SERVER_TEXTS.findingExtensionRequired,
      '/extension:type': SERVER_TEXTS.findingExtensionRequired,
      '/extension:minLength': SERVER_TEXTS.findingExtensionRequired,
    },
  },
);

export function registerNodeFindingActionsRoutes(
  app: Hono,
  deps: TFindingActionsRouteDeps,
): void {
  app.post('/api/nodes/:pathB64/findings/:id/dismiss', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const id = parseFindingId(c.req.param('id'));
    const body = await parseDismissBody(c.req.raw);
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const finding = await loadFindingOr404(adapter, id, nodePath);
        // Kernel safety-lane rows are not dismissible in either mode
        // (spec §sm findings dismiss): they flag injection / malformed
        // content.
        if (finding.origin === 'kernel') {
          throw new ConflictError({
            code: 'finding-not-dismissible',
            message: tx(SERVER_TEXTS.findingNotDismissible, {
              id,
              type: sanitizeForTerminal(finding.type),
            }),
          });
        }
        if (body.class !== true) {
          // ROW-grain default (2026-07-22): a resolution state, no
          // sidecar, no consent; dies when the finder re-judges.
          const rowOutcome = await adapter.findings.dismissByHuman(id, null, Date.now());
          if (rowOutcome.kind === 'already-dismissed') {
            throw new ConflictError({
              code: 'finding-terminal',
              message: tx(SERVER_TEXTS.findingAlreadyDismissed, { id }),
            });
          }
          if (rowOutcome.kind === 'not-found') return null;
          return 'dismissed';
        }
        await writeSuppressions(adapter, deps, nodePath, (entries) =>
          mergeSuppression(entries, buildSuppressionEntry(finding.extensionId, finding.type, undefined)),
          { confirm: body.confirm, always: body.always },
        );
        return 'dismissed';
      },
    );
    if (outcome === null) throw findingNotFound(id);
    appendOperation(deps.runtimeContext.cwd, {
      op: 'findings.dismiss',
      target: nodePath,
      channel: 'ui',
      outcome: 'ok',
      detail: `id=${id}${body.class === true ? ' class' : ' row'}`,
    });
    reloadOnPersistedGrant(deps, body.always);
    return c.body(null, 204);
  });

  // Row-grain restore (`sm findings reopen`): clears ANY resolution back
  // to open. No sidecar, no consent; class suppressions restore via the
  // undismiss route instead (the tray branches on the row's resolution).
  app.post('/api/nodes/:pathB64/findings/:id/reopen', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const id = parseFindingId(c.req.param('id'));
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        await loadFindingOr404(adapter, id, nodePath);
        return adapter.findings.reopen(id, Date.now());
      },
    );
    if (outcome === null || outcome.kind === 'not-found') throw findingNotFound(id);
    if (outcome.kind === 'already-open') {
      throw new ConflictError({
        code: 'finding-open',
        message: tx(SERVER_TEXTS.findingAlreadyOpen, { id }),
      });
    }
    appendOperation(deps.runtimeContext.cwd, {
      op: 'findings.reopen',
      target: nodePath,
      channel: 'ui',
      outcome: 'ok',
      detail: `id=${id}`,
    });
    return c.body(null, 204);
  });

  app.post('/api/nodes/:pathB64/findings/:id/resolve', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const id = parseFindingId(c.req.param('id'));
    const body = await parseResolveBody(c.req.raw);
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        await loadFindingOr404(adapter, id, nodePath);
        return adapter.findings.resolveByHuman(id, body.note ?? null, Date.now());
      },
    );
    if (outcome === null || outcome.kind === 'not-found') throw findingNotFound(id);
    if (outcome.kind === 'already-fixed') {
      throw new ConflictError({
        code: 'finding-already-fixed',
        message: tx(SERVER_TEXTS.findingAlreadyFixed, { id }),
      });
    }
    appendOperation(deps.runtimeContext.cwd, {
      op: 'findings.resolve',
      target: nodePath,
      channel: 'ui',
      outcome: 'ok',
      detail: `id=${id}`,
    });
    return c.body(null, 204);
  });

  app.post('/api/nodes/:pathB64/findings/undismiss', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const body = await parseUndismissBody(c.req.raw);
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return 'node-gone';
        const mdAbs = resolve(deps.runtimeContext.cwd, nodePath);
        const entries = existingSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
        // EXACT identity: the UI passes the revealed row's qualified
        // extensionId + type, so the CLI's bare-id convenience (and its
        // ambiguity refusal) has no place here.
        const isTarget = (e: Record<string, unknown>): boolean =>
          e['extension'] === body.extension &&
          normalizeSuppressionType(e['type']) === body.type;
        if (!entries.some(isTarget)) {
          // Self-heal before the 404 (same rule as the CLI verb): the
          // mirror may claim a suppression the live file no longer carries.
          await refreshMirror(adapter, deps, nodePath, mdAbs);
          return 'no-match';
        }
        await writeSuppressions(
          adapter,
          deps,
          nodePath,
          (all) => all.filter((e) => !isTarget(e)),
          { confirm: body.confirm, always: body.always },
        );
        return 'removed';
      },
    );
    if (outcome === null || outcome === 'node-gone') {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }
    if (outcome === 'no-match') {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.suppressionNotFound, {
          extension: sanitizeForTerminal(body.extension),
          node: sanitizeForTerminal(nodePath),
        }),
      });
    }
    appendOperation(deps.runtimeContext.cwd, {
      op: 'findings.undismiss',
      target: nodePath,
      extension: body.extension,
      channel: 'ui',
      outcome: 'ok',
    });
    reloadOnPersistedGrant(deps, body.always);
    return c.body(null, 204);
  });

  app.delete('/api/nodes/:pathB64/findings/:id', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const id = parseFindingId(c.req.param('id'));
    const body = await parseDeleteBody(c.req.raw);
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const finding = await loadFindingOr404(adapter, id, nodePath);
        // Sidecar FIRST, row second: the orphan-suppression lift below
        // is consent-gated, so its 412 must fire before any mutation
        // (a deleted row with a parked retry would 404 on re-entry).
        await liftOrphanSuppression(adapter, deps, nodePath, finding, body);
        return adapter.findings.removeById(id);
      },
    );
    if (outcome !== true) throw findingNotFound(id);
    appendOperation(deps.runtimeContext.cwd, {
      op: 'findings.delete',
      target: nodePath,
      channel: 'ui',
      outcome: 'ok',
      detail: `id=${id}`,
    });
    reloadOnPersistedGrant(deps, body.always);
    return c.body(null, 204);
  });
}

/**
 * Deleting the LAST row of a dismissed class also removes its exact
 * `(extension, type)` suppression entry (user call 2026-07-20: an
 * orphan dismissal would make the class come back HIDDEN when a later
 * finder run re-finds it). Sibling rows of the same class keep the
 * entry (their dismissal is still live); type-less blanket entries are
 * never touched (not authored by a per-row dismiss). The write rides
 * the same gated channel as dismiss, so a missing standing consent
 * surfaces as the 412 handshake BEFORE the row delete runs.
 */
async function liftOrphanSuppression(
  adapter: StoragePort,
  deps: TFindingActionsRouteDeps,
  nodePath: string,
  finding: IFindingRecord,
  consent: { confirm?: boolean | undefined; always?: boolean | undefined },
): Promise<void> {
  const mdAbs = resolve(deps.runtimeContext.cwd, nodePath);
  const entries = existingSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
  const isTarget = (e: Record<string, unknown>): boolean =>
    e['extension'] === finding.extensionId &&
    normalizeSuppressionType(e['type']) === finding.type;
  if (!entries.some(isTarget)) return;
  const rows = await adapter.findings.list({ nodeId: nodePath, includeStale: true });
  const hasSibling = rows.some(
    (f) => f.id !== finding.id && f.extensionId === finding.extensionId && f.type === finding.type,
  );
  if (hasSibling) return;
  await writeSuppressions(adapter, deps, nodePath, (all) => all.filter((e) => !isTarget(e)), consent);
}

/** Parse the `:id` segment to a positive integer; anything else is a 404. */
function parseFindingId(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw findingNotFound(sanitizeForTerminal(raw));
  return parsed;
}

function findingNotFound(id: number | string): HTTPException {
  return new HTTPException(404, {
    message: tx(SERVER_TEXTS.findingNotFound, { id }),
  });
}

/**
 * Load a finding by id, scoped to the route's node (an id living on another
 * node is a 404: the URL claims a resource under THIS node).
 */
async function loadFindingOr404(
  adapter: StoragePort,
  id: number,
  nodePath: string,
): Promise<IFindingRecord> {
  const finding = await adapter.findings.get(id);
  if (!finding || finding.nodeId !== nodePath) throw findingNotFound(id);
  return finding;
}

/**
 * Apply an edit over the node's `annotations.suppressions` through the
 * gated channel and refresh the write-through mirror. `EConsentRequiredError`
 * / `ESidecarWritersForbiddenError` propagate to the global handler
 * (`412 confirm-required` / `403 sidecar-writers-forbidden`). A brand-new
 * (or invalid) sidecar sources its required `identity` block from the live
 * scan node, mirror of the CLI dismiss.
 */
async function writeSuppressions(
  adapter: StoragePort,
  deps: TFindingActionsRouteDeps,
  nodePath: string,
  edit: (entries: Record<string, unknown>[]) => Record<string, unknown>[],
  consent: { confirm?: boolean | undefined; always?: boolean | undefined },
): Promise<void> {
  const mdAbs = resolve(deps.runtimeContext.cwd, nodePath);
  const read = readSidecarFor(mdAbs);
  const changes: Record<string, unknown> = {
    annotations: { suppressions: edit(existingSuppressions(read.parsed?.annotations)) },
  };
  if (read.parsed === null) {
    const bundle = await adapter.scans.findNode(nodePath);
    if (!bundle) throw findingNotFound(nodePath);
    changes['identity'] = {
      path: bundle.node.path,
      bodyHash: bundle.node.bodyHash,
      frontmatterHash: bundle.node.frontmatterHash,
    };
  }
  const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
  await store.applyPatch(sidecarPathFor(mdAbs), changes, {
    confirm: consent.confirm === true,
    always: consent.always === true,
    cwd: deps.runtimeContext.cwd,
  });
  await refreshMirror(adapter, deps, nodePath, mdAbs);
}

/** Write-through: mirror the node's CURRENT live annotations to the column. */
async function refreshMirror(
  adapter: StoragePort,
  deps: TFindingActionsRouteDeps,
  nodePath: string,
  mdAbs: string,
): Promise<void> {
  await adapter.scans.refreshAnnotations(
    nodePath,
    readSidecarFor(mdAbs).parsed?.annotations ?? null,
  );
}

/**
 * After a persisted `always` grant, reload the config cache so subsequent
 * requests see `allowEditSmFiles: true` (mirror of `POST /api/actions/:id`).
 */
function reloadOnPersistedGrant(deps: TFindingActionsRouteDeps, always: boolean | undefined): void {
  if (always === true) deps.configService.reload();
}
