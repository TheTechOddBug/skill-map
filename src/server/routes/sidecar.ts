/**
 * `POST /api/sidecar/bump`, UI-driven sidecar bump endpoint (Step 9.6.5,
 * BFF half).
 *
 * Mirrors the `sm bump <node.path> [--force]` CLI verb (`cli/commands/bump.ts`)
 * 1:1, same Action (`built-in-plugins/actions/bump`), same Store
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
 *     overlay), `status: 'fresh'`. **No broadcast**, nothing changed
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
 * value variant, the payload is a custom `value` object, not an
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
 * The WS event mirrors the rest of the kernel→broadcaster bridge, every
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
import { assertContained } from '../../core/paths/path-guard.js';
import { EConsentRequiredError } from '../../core/config/sidecar-consent.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { TActionWrite } from '../../kernel/extensions/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import type { WsBroadcaster } from '../broadcaster.js';
import type { IWsEventEnvelope } from '../events.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
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

interface IBumpBody {
  nodePath: string;
  force?: boolean;
  /**
   * Operator's consent to write `.sm` sidecars in this project. When
   * `false` (or absent) and `allowEditSmFiles` is not yet `true`, the
   * write throws `EConsentRequiredError` and the route returns 412
   * `confirm-required` so the UI can open a `ConfirmationService`
   * dialog and retry with `confirm: true`.
   */
  confirm?: boolean;
}

const BUMP_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nodePath'],
  properties: {
    nodePath: { type: 'string', minLength: 1 },
    force: { type: 'boolean' },
    confirm: { type: 'boolean' },
  },
} as const;

const parseBody = makeBodyValidator<IBumpBody>(BUMP_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.sidecarBodyNotJson,
  notObject: SERVER_TEXTS.sidecarBodyNotObject,
  invalid: SERVER_TEXTS.sidecarBodyNotObject,
  mapping: {
    '/nodePath:required': SERVER_TEXTS.sidecarNodePathRequired,
    ':type:object': SERVER_TEXTS.sidecarBodyNotObject,
    '/nodePath:type:string': SERVER_TEXTS.sidecarNodePathRequired,
    '/nodePath:minLength': SERVER_TEXTS.sidecarNodePathRequired,
    '/force:type:boolean': SERVER_TEXTS.sidecarForceMustBeBoolean,
    '/confirm:type:boolean': SERVER_TEXTS.sidecarConfirmMustBeBoolean,
  },
});

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
 * `IWsEventEnvelope.data` slot (see `server/events.ts`), every WS event
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

    // Refusal, fresh node, no force. The `sidecar-fresh:` prefix in
    // the catalog message is load-bearing: HTTP 409 already maps to
    // the `sidecar-fresh` envelope `code` in `app.onError`, but the
    // prefix keeps log-grep affinity with the CLI's `sm bump` verb.
    if (result.report.ok === false && result.report.reason === 'fresh') {
      throw new HTTPException(409, { message: SERVER_TEXTS.sidecarFreshRefusal });
    }

    // Force-on-fresh silent no-op, return 200 with the existing
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

    // Stale / first-time, materialise the writes through the same
    // store the CLI uses.
    const store = new FilesystemSidecarStore();
    try {
      for (const w of result.writes ?? []) {
        if (w.kind === 'sidecar') {
          await store.applyPatch(w.path, w.changes, {
            confirm: body.confirm === true,
            cwd: deps.runtimeContext.cwd,
            homedir: deps.runtimeContext.homedir,
          });
        }
      }
    } catch (err) {
      // `EConsentRequiredError` is mapped by `app.onError` to 412
      // `confirm-required`; everything else surfaces as a 500.
      if (err instanceof EConsentRequiredError) throw err;
      throw new HTTPException(500, { message: formatErrorMessage(err) });
    }

    // If consent was newly granted in this request, drop the cached
    // config view so the next read sees `allowEditSmFiles: true`
    // without a `sm serve` restart. (No-op when the value was
    // already true before this request.)
    if (body.confirm === true) {
      deps.configService.reload();
    }

    const newVersion = result.report.version ?? null;
    const eventData: ISidecarBumpedEventData = {
      nodePath: node.path,
      version: newVersion,
      status: STATUS_FRESH,
    };
    // Canonical `{ type, timestamp, data }` envelope per
    // `server/events.ts:IWsEventEnvelope`, matches the kernel→broadcaster
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
 * Load the persisted node by its scope-relative path. Mirrors the
 * single-node lookup in `sm bump`: open the DB read-only via
 * `tryWithSqlite`, scan the persisted node list, return the matching
 * row. 404 when the DB is missing OR the node is not in the persisted
 * scan, same client-facing semantics as `/api/nodes/:pathB64`.
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
    throw new HTTPException(500, { message: SERVER_TEXTS.sidecarBumpInvokeMissing });
  }
  const input: IBumpInput = {};
  if (body.force === true) input.force = true;
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
 * force-on-fresh path can't happen in that case, fresh requires a
 * present sidecar, but the helper is defensive).
 */
function pickExistingVersion(node: Node): number | null {
  const overlay = node.sidecar;
  if (!overlay || overlay.present !== true) return null;
  const annotations = overlay.annotations;
  if (!annotations) return null;
  const v = (annotations as Record<string, unknown>)['version'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
