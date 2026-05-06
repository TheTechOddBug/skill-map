/**
 * `POST /api/sidecar/bump` — UI-driven sidecar bump endpoint (Step 9.6.5,
 * BFF half).
 *
 * Mirrors the `sm bump <node.path> [--force]` CLI verb (`cli/commands/bump.ts`)
 * 1:1 — same Action (`built-in-plugins/actions/bump`), same Store
 * (`FilesystemSidecarStore`), same refusal semantics on a fresh node.
 * The only differences are the invoker label (`'ui'` vs `'cli'`) and
 * the wire shape (REST envelope + WS event vs stdout/stderr).
 *
 * Behaviour matrix (locked in the Step 9.6.5 brief):
 *
 *   - Stale node (or no sidecar yet) → 200 envelope, version
 *     incremented, `status: 'fresh'`. Broadcast `sidecar.bumped`.
 *   - Fresh node + `force !== true` → 409 `sidecar-fresh`. NO broadcast.
 *   - Fresh node + `force === true` → silent no-op per the Action spec
 *     (Action returns `{ ok: true, noop: true }` with no writes). 200
 *     envelope, `version` reflects the existing value (read off the
 *     overlay), `status: 'fresh'`. **No broadcast** — nothing changed
 *     on disk, sending a `sidecar.bumped` would tell every connected UI
 *     to refresh state that hasn't moved. (Decision: no-op = no event.)
 *   - Unknown `nodePath` → 404. NO broadcast.
 *   - Malformed body (missing nodePath, wrong types) → 400 `bad-query`.
 *
 * The route deliberately re-implements only the single-node flow. The
 * batch (`--pending`) flow stays CLI-only at 9.6.5; surfacing it over
 * REST would need a job-style progress channel.
 *
 * Wire shape (envelope per `spec/schemas/api/rest-envelope.schema.json`,
 * value variant — the payload is a custom `value` object, not an
 * envelope-list `item`, since the sidecar bump report doesn't fit any
 * of the existing list/single discriminators):
 *
 *   ```jsonc
 *   {
 *     "schemaVersion": "1",
 *     "kind": "sidecar.bumped",       // canonical, listed in
 *                                     // rest-envelope.schema.json's enum
 *                                     // (R7 closed at 9.6.7).
 *     "value": {
 *       "nodePath": "<scope-relative>",
 *       "version": <int|null>,
 *       "status": "fresh"
 *     },
 *     "elapsedMs": <int>
 *   }
 *   ```
 *
 * The WS event mirrors the rest of the kernel→broadcaster bridge — every
 * event flows over `/ws` as `{ type, timestamp, data }` per
 * `events.ts:IWsEventEnvelope` (R9 closed at 9.6.7; the prior flat shape
 * forced the UI's `isWsEvent` guard to accept two variants).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';
import { resolve } from 'node:path';

import {
  bumpAction,
  type IBumpInput,
  type IBumpReport,
} from '../../built-in-plugins/actions/bump/index.js';
import { assertContained } from '../../cli/util/path-guard.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { TActionWrite } from '../../kernel/extensions/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import type { WsBroadcaster } from '../broadcaster.js';
import type { IWsEventEnvelope } from '../events.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IRouteDeps } from './deps.js';

/**
 * Locked status string emitted on a successful bump (or a force-on-fresh
 * no-op). Matches the wire-shape constant in the brief; if the kernel
 * ever extends `SidecarStatus`, mapping happens here, not at the call
 * site.
 */
const STATUS_FRESH = 'fresh' as const;

/**
 * REST envelope `kind` discriminator. Listed in the canonical
 * `rest-envelope.schema.json#/properties/kind/enum` since 9.6.7
 * (R7 closed in the same batch as R9).
 */
const ENVELOPE_KIND = 'sidecar.bumped' as const;

/**
 * Error code surfaced when the route refuses a fresh-node bump without
 * `--force`. The global `app.onError` maps the HTTP status to the
 * envelope `error.code` (`HTTPException(409)` is not currently mapped
 * — falls through to `'internal'` — so we encode the semantic code in
 * the message body explicitly via the `details` channel exposed by the
 * thrown HTTPException's `message` field).
 *
 * The route below carries both: HTTP 409 for the status code, and a
 * message that the UI can pattern-match for `sidecar-fresh`.
 */
const REFUSAL_MESSAGE = 'sidecar-fresh: Node is fresh; pass force:true to bump anyway.';

interface IBumpBody {
  nodePath: string;
  force: boolean;
  reason?: string;
}

interface ISidecarBumpedValue {
  nodePath: string;
  version: number | null;
  status: typeof STATUS_FRESH;
}

interface ISidecarBumpedEnvelope {
  schemaVersion: '1';
  kind: typeof ENVELOPE_KIND;
  value: ISidecarBumpedValue;
  elapsedMs: number;
}

/**
 * Payload of the `sidecar.bumped` WS event. Carried under the standard
 * `IWsEventEnvelope.data` slot (see `server/events.ts`) — every WS event
 * the BFF broadcasts wraps its payload in `{ type, timestamp, data }` so
 * the SPA's `isWsEvent` guard validates a single shape (R9 closed at
 * 9.6.7).
 */
interface ISidecarBumpedEventData {
  nodePath: string;
  version: number | null;
  status: typeof STATUS_FRESH;
}

export interface ISidecarRouteDeps extends IRouteDeps {
  broadcaster: WsBroadcaster;
}

export function registerSidecarRoutes(app: Hono, deps: ISidecarRouteDeps): void {
  // Complexity comes from the four exit branches the route models
  // (refusal, no-op, materialise-and-broadcast, error-while-materialising)
  // plus the path-guard preflight. Each branch is a direct return; an
  // extracted helper would just push the discriminator out one level.
  // eslint-disable-next-line complexity
  app.post('/api/sidecar/bump', async (c) => {
    const startedAt = Date.now();
    const body = await parseBody(c.req.raw);
    const node = await loadNode(deps, body.nodePath);

    let absPath: string;
    try {
      assertContained(deps.runtimeContext.cwd, node.path);
      absPath = resolve(deps.runtimeContext.cwd, node.path);
    } catch (err) {
      throw new HTTPException(500, { message: formatErrorMessage(err) });
    }

    const result = invokeBump(node, absPath, body);

    // Refusal — fresh node, no force.
    if (result.report.ok === false && result.report.reason === 'fresh') {
      throw new HTTPException(409, { message: REFUSAL_MESSAGE });
    }

    // Force-on-fresh silent no-op — return 200 with the existing
    // version, no broadcast (see file header §Behaviour matrix).
    if (result.report.ok === true && result.report.noop === true) {
      const envelope: ISidecarBumpedEnvelope = {
        schemaVersion: '1',
        kind: ENVELOPE_KIND,
        value: {
          nodePath: node.path,
          version: pickExistingVersion(node),
          status: STATUS_FRESH,
        },
        elapsedMs: Date.now() - startedAt,
      };
      return c.json(envelope);
    }

    // Stale / first-time — materialise the writes through the same
    // store the CLI uses.
    const store = new FilesystemSidecarStore();
    try {
      for (const w of result.writes ?? []) {
        if (w.kind === 'sidecar') {
          await store.applyPatch(w.path, w.changes);
        }
      }
    } catch (err) {
      throw new HTTPException(500, { message: formatErrorMessage(err) });
    }

    const newVersion = result.report.version ?? null;
    const eventData: ISidecarBumpedEventData = {
      nodePath: node.path,
      version: newVersion,
      status: STATUS_FRESH,
    };
    // Canonical `{ type, timestamp, data }` envelope per
    // `server/events.ts:IWsEventEnvelope` — matches the kernel→broadcaster
    // bridge in `watcher.ts` (every `scan.*` event flows through the same
    // shape). Timestamp serialised as ISO 8601 to match the kernel
    // orchestrator's `makeEvent` (`src/kernel/orchestrator.ts`); the SPA
    // already accepts both ISO and unix-ms per `IWsEventEnvelope.timestamp`.
    const wsEnvelope: IWsEventEnvelope<ISidecarBumpedEventData> = {
      type: ENVELOPE_KIND,
      timestamp: new Date().toISOString(),
      data: eventData,
    };
    deps.broadcaster.broadcast(wsEnvelope);

    const envelope: ISidecarBumpedEnvelope = {
      schemaVersion: '1',
      kind: ENVELOPE_KIND,
      value: {
        nodePath: node.path,
        version: newVersion,
        status: STATUS_FRESH,
      },
      elapsedMs: Date.now() - startedAt,
    };
    return c.json(envelope);
  });
}

/**
 * Parse + validate the JSON body manually. The BFF does not pull in
 * `@hono/zod-validator` / `zod` (per the no-new-deps rule — see report);
 * existing routes parse query/body via small typed helpers and throw
 * `HTTPException(400)` so the global `app.onError` formats the bad-query
 * envelope.
 */
// Complexity comes from one validation guard per accepted body field
// (nodePath required + non-empty, force optional but type-checked,
// reason optional but type-checked) plus the JSON-parse + shape
// guards. Each branch throws a typed `HTTPException(400)` so the
// global error envelope kicks in; no further extraction would help
// readability.
// eslint-disable-next-line complexity
async function parseBody(req: Request): Promise<IBumpBody> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON.' });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HTTPException(400, { message: 'Request body must be a JSON object.' });
  }
  const obj = raw as Record<string, unknown>;
  const nodePathRaw = obj['nodePath'];
  if (typeof nodePathRaw !== 'string' || nodePathRaw.length === 0) {
    throw new HTTPException(400, { message: '`nodePath` is required and must be a non-empty string.' });
  }
  const forceRaw = obj['force'];
  if (forceRaw !== undefined && typeof forceRaw !== 'boolean') {
    throw new HTTPException(400, { message: '`force` must be a boolean when present.' });
  }
  const reasonRaw = obj['reason'];
  if (reasonRaw !== undefined && typeof reasonRaw !== 'string') {
    throw new HTTPException(400, { message: '`reason` must be a string when present.' });
  }
  const out: IBumpBody = {
    nodePath: nodePathRaw,
    force: forceRaw === true,
  };
  if (reasonRaw !== undefined) out.reason = reasonRaw;
  return out;
}

/**
 * Load the persisted node by its scope-relative path. Mirrors the
 * single-node lookup in `sm bump`: open the DB read-only via
 * `tryWithSqlite`, scan the persisted node list, return the matching
 * row. 404 when the DB is missing OR the node is not in the persisted
 * scan — same client-facing semantics as `/api/nodes/:pathB64`.
 */
async function loadNode(deps: IRouteDeps, nodePath: string): Promise<Node> {
  const persisted = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async (adapter) => adapter.scans.load(),
  );
  const node = persisted?.nodes.find((n) => n.path === nodePath);
  if (!node) {
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.nodeNotFound, { path: nodePath }),
    });
  }
  return node;
}

/**
 * Invoke the built-in `core/bump` Action with `invoker: 'ui'`. Mirrors
 * `invokeBumpFor` in `cli/commands/bump.ts` except for the invoker label.
 */
function invokeBump(
  node: Node,
  absPath: string,
  body: IBumpBody,
): { report: IBumpReport; writes?: TActionWrite[] } {
  if (!bumpAction.invoke) {
    throw new HTTPException(500, { message: 'built-in bump action is missing its invoke()' });
  }
  const input: IBumpInput = {};
  if (body.force) input.force = true;
  if (body.reason !== undefined) input.reason = body.reason;
  return bumpAction.invoke<IBumpInput, IBumpReport>(input, {
    node,
    nodeAbsolutePath: absPath,
    invoker: 'ui',
    now: () => new Date(),
  });
}

/**
 * Read the existing `annotations.version` off the node's sidecar
 * overlay. Returns `null` when the node has no sidecar (the
 * force-on-fresh path can't happen in that case — fresh requires a
 * present sidecar — but the helper is defensive).
 */
function pickExistingVersion(node: Node): number | null {
  const overlay = node.sidecar;
  if (!overlay || overlay.present !== true) return null;
  const annotations = overlay.annotations;
  if (!annotations) return null;
  const v = (annotations as Record<string, unknown>)['version'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
