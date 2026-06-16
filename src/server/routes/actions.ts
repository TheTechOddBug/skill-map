/**
 * `POST /api/actions/:pluginId/:actionId`, generic Action-dispatch
 * endpoint (Step 17, Decision #4).
 *
 * The qualified action id `<plugin>/<action>` (e.g. `core/node-bump`)
 * is two URL segments, not one: Hono's `:param` never matches a `/`,
 * so the id is captured as two params and recomposed via
 * `qualifiedExtensionId(pluginId, actionId)` (same pattern the
 * contributions route uses for its three-segment qualified id). Each
 * segment is validated against the qualified-id alphabet at the edge,
 * a slash / control char / ANSI escape rejects with 400 before any
 * registry lookup.
 *
 * Generalises the legacy `POST /api/sidecar/bump` route: instead of
 * hardcoding the `core/node-bump` Action, it resolves an arbitrary
 * qualified action id (`<plugin>/<action>`) off the kernel registry,
 * invokes it against a node loaded by `body.nodePath`, and materialises
 * any returned sidecar writes through the same consent-gated
 * `FilesystemSidecarStore` the CLI bump verb uses. The route is the
 * single entry point for every inspector action button (Phase D wires
 * `core/node-bump`; later steps add stability, tags).
 *
 * Behaviour matrix (mirrors the bump route's semantics, generically):
 *
 *   - Malformed `:pluginId` / `:actionId` segment -> 400 `bad-query`.
 *   - Unknown / non-invokable action id      -> 404 (no registered
 *     action of that id, or the action ships no deterministic
 *     `invoke()`).
 *   - Unknown `body.nodePath`                -> 404 (via `loadNode`).
 *   - Path containment failure on `nodePath` -> 400 `bad-query`.
 *   - Report `ok: false`                     -> 409. The report's
 *     `reason` (when present) becomes the envelope `code`; the fallback
 *     `action-refused` covers reports that refuse without a reason. NO
 *     broadcast.
 *   - Report `ok: true, noop: true`          -> 200 `action.applied`
 *     with the report, NO broadcast (no-op = no event, mirrors bump).
 *   - Report `ok: true` with writes          -> materialise, 200
 *     `action.applied`, broadcast `action.applied`.
 *   - Malformed body                         -> 400 `bad-query`.
 *
 * Consent (Step 17, Decision #5): each `sidecar` write threads the
 * operator's two-tier consent (`confirm` one-shot, `always` persist)
 * into `store.applyPatch`. The store's gate
 * (`core/config/sidecar-consent.ts`) flips `allowEditSmFiles` on disk
 * only when `always: true`; `confirm: true` lets the write through
 * without persisting. A missing grant throws `EConsentRequiredError`,
 * mapped by the global `app.onError` to 412 `confirm-required` with
 * `details.key = 'allowEditSmFiles'`.
 *
 * Wire shape (envelope per `spec/schemas/api/rest-envelope.schema.json`,
 * action-result variant: `value` + `elapsedMs`):
 *
 *   ```jsonc
 *   {
 *     "schemaVersion": "1",
 *     "kind": "action.applied",
 *     "value": { "actionId": "<plugin>/<action>", "nodePath": "<rel>", "report": { ... } },
 *     "elapsedMs": <int>
 *   }
 *   ```
 *
 * The WS event mirrors the kernel->broadcaster bridge: every event flows
 * over `/ws` as `{ type, timestamp, data }` per `events.ts`.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';
import { resolve } from 'node:path';

import { assertContained } from '../../core/paths/path-guard.js';
import { ActionRefusedError } from '../app.js';
import { EConsentRequiredError, ESidecarWritersForbiddenError, ensureSidecarWritesAllowed } from '../../core/config/sidecar-consent.js';
import type { IAction, IActionContext, IActionResult, TActionWrite } from '../../kernel/extensions/index.js';
import type { Kernel } from '../../kernel/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { resolveGitAuthorName } from '../../cli/util/git.js';
import type { WsBroadcaster } from '../broadcaster.js';
import type { IActionAppliedEventData, IWsEventEnvelope } from '../events.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';
import { loadNode } from './node-loader.js';

/**
 * REST envelope `kind` discriminator. Listed in the canonical
 * `rest-envelope.schema.json#/properties/kind/enum` (shares the
 * action-result `oneOf` variant with `sidecar.bumped`).
 */
const ENVELOPE_KIND = 'action.applied' as const;

/**
 * Canonical refusal code emitted when an Action's report comes back
 * `ok: false` without naming a `reason`. A report that DOES carry a
 * `reason` overrides this (the reason becomes the envelope `code`).
 */
const REFUSED_CODE = 'action-refused' as const;

/**
 * Invoker channel fallback, stamped on the `IActionContext` when the
 * project is not a Git repo (otherwise both the CLI and the BFF stamp
 * the resolved Git `user.name`). Mirrors the bump route's `'ui'`.
 */
const INVOKER_FALLBACK = 'ui' as const;

/**
 * Qualified-id alphabet, mirror of the contributions route. Restricting
 * each URL segment to this set BEFORE the registry lookup rejects
 * slashes, spaces, ANSI escapes, and other control bytes at the edge of
 * the BFF so the lookup and the error message both stay clean.
 */
const QUALIFIED_ID_SEGMENT = /^[A-Za-z0-9._-]+$/;

interface IActionBody {
  nodePath: string;
  /**
   * Action-specific input, forwarded verbatim to `invoke(input, ctx)`.
   * Reserved for Steps 2+ (stability's enum, tags); the bump migration
   * (Phase D) omits it entirely. Defaults to `{}` when absent.
   */
  input?: Record<string, unknown>;
  /**
   * One-shot consent to write `.sm` sidecars (does NOT persist). When
   * `false`/absent and `allowEditSmFiles` is not yet `true`, the write
   * throws `EConsentRequiredError` -> 412 `confirm-required`.
   */
  confirm?: boolean;
  /**
   * Persistent consent: flips `allowEditSmFiles` to `true` on disk so
   * the project never re-asks. Implies `confirm`.
   */
  always?: boolean;
}

const ACTION_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nodePath'],
  properties: {
    nodePath: { type: 'string', minLength: 1 },
    input: { type: 'object' },
    confirm: { type: 'boolean' },
    always: { type: 'boolean' },
  },
} as const;

const parseBody = makeBodyValidator<IActionBody>(ACTION_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.actionBodyNotJson,
  notObject: SERVER_TEXTS.actionBodyNotObject,
  invalid: SERVER_TEXTS.actionBodyNotObject,
  mapping: {
    '/nodePath:required': SERVER_TEXTS.actionNodePathRequired,
    ':type:object': SERVER_TEXTS.actionBodyNotObject,
    '/nodePath:type:string': SERVER_TEXTS.actionNodePathRequired,
    '/nodePath:minLength': SERVER_TEXTS.actionNodePathRequired,
    '/input:type:object': SERVER_TEXTS.actionInputMustBeObject,
    '/confirm:type:boolean': SERVER_TEXTS.actionConfirmMustBeBoolean,
    '/always:type:boolean': SERVER_TEXTS.actionAlwaysMustBeBoolean,
  },
});

interface IActionAppliedValue {
  actionId: string;
  nodePath: string;
  report: unknown;
}

interface IActionAppliedEnvelope {
  schemaVersion: '1';
  kind: typeof ENVELOPE_KIND;
  value: IActionAppliedValue;
  elapsedMs: number;
}

/**
 * Minimal report shape this route reasons about. Actions carry their own
 * richer report types; the route only branches on the universal
 * `ok` / `noop` / `reason` fields shared across the report base schema.
 */
interface IActionReportView {
  ok?: boolean;
  noop?: boolean;
  reason?: string;
}

export interface IActionsRouteDeps extends IRouteDeps {
  broadcaster: WsBroadcaster;
  kernel: Kernel;
}

export function registerActionsRoutes(app: Hono, deps: IActionsRouteDeps): void {
  app.post('/api/actions/:pluginId/:actionId', async (c) => {
    const startedAt = Date.now();
    // Validate each URL segment against the qualified-id alphabet
    // BEFORE recomposing + looking up, a slash / control char / ANSI
    // escape rejects with 400 and never reaches the registry.
    const pluginId = parseSegment(c.req.param('pluginId'), 'pluginId');
    const shortId = parseSegment(c.req.param('actionId'), 'actionId');
    const actionId = qualifiedExtensionId(pluginId, shortId);
    const action = resolveInvokableAction(deps.kernel, actionId);
    const body = await parseBody(c.req.raw);
    const node = await loadNode(deps, body.nodePath);

    let absPath: string;
    try {
      assertContained(deps.runtimeContext.cwd, node.path);
      absPath = resolve(deps.runtimeContext.cwd, node.path);
    } catch (err) {
      // Path containment failure on a client-supplied `nodePath` is a
      // client error. `assertContained` throws plain `Error` with no
      // stable class to switch on in `app.onError`, so we wrap to 400
      // locally (same as the legacy bump route).
      throw new HTTPException(400, { message: formatErrorMessage(err) });
    }

    const result = invokeAction(action, absPath, node, body, deps.runtimeContext.cwd);
    const report = result.report as IActionReportView;

    // Refusal: the Action declined. The report's `reason` becomes the
    // envelope `code`; the fallback `action-refused` covers a refusal
    // with no named reason. NO broadcast.
    if (report.ok === false) {
      const reason = typeof report.reason === 'string' && report.reason.length > 0
        ? sanitizeForTerminal(report.reason)
        : REFUSED_CODE;
      throw new ActionRefusedError({
        code: reason,
        message: tx(SERVER_TEXTS.actionRefused, {
          actionId: sanitizeForTerminal(actionId),
          nodePath: sanitizeForTerminal(node.path),
        }),
        actionId,
        nodePath: node.path,
        report: result.report,
      });
    }

    // Silent no-op (e.g. force-on-fresh bump): nothing changed on disk,
    // return the report with no broadcast (no-op = no event).
    if (report.ok === true && report.noop === true) {
      return c.json(buildEnvelope(actionId, node.path, result.report, startedAt));
    }

    // Materialise the writes through the consent-gated store.
    await materializeWrites(result.writes, body, deps.runtimeContext.cwd);

    // Persistent consent (`always`) flipped the cached config view; drop
    // it so the next read sees `allowEditSmFiles: true` without a
    // restart. One-shot `confirm` persists nothing, so it needs no
    // reload.
    if (body.always === true) {
      deps.configService.reload();
    }

    // Broadcast the canonical `{ type, timestamp, data }` envelope, ISO
    // 8601 timestamp to match the kernel orchestrator's `makeEvent`.
    const eventData: IActionAppliedEventData = {
      actionId,
      nodePath: node.path,
      report: result.report,
    };
    const wsEnvelope: IWsEventEnvelope<IActionAppliedEventData> = {
      type: ENVELOPE_KIND,
      timestamp: new Date().toISOString(),
      data: eventData,
    };
    deps.broadcaster.broadcast(wsEnvelope);

    return c.json(buildEnvelope(actionId, node.path, result.report, startedAt));
  });
}

/**
 * Validate a single qualified-id URL segment against the alphabet
 * (`[A-Za-z0-9._-]+`). Rejects slashes, spaces, ANSI escapes, and other
 * control bytes with 400 `bad-query` before any registry lookup. The
 * offending value is sanitised before interpolation into the error
 * message.
 */
function parseSegment(value: string, name: string): string {
  if (!QUALIFIED_ID_SEGMENT.test(value)) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.qualifiedIdMalformed, {
        name,
        value: sanitizeForTerminal(value),
      }),
    });
  }
  return value;
}

/**
 * Resolve a qualified action id off the kernel registry and narrow it to
 * an invokable `IAction`. 404 when no action of that id is registered OR
 * the action ships no deterministic `invoke()` (a probabilistic action
 * that this synchronous route cannot dispatch). The id is sanitised
 * before interpolation into the 404 envelope.
 */
function resolveInvokableAction(kernel: Kernel, actionId: string): IAction {
  const ext = kernel.registry.get('action', actionId);
  const action = ext as IAction | undefined;
  if (!action || typeof action.invoke !== 'function') {
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.actionUnknown, { actionId: sanitizeForTerminal(actionId) }),
    });
  }
  return action;
}

/**
 * Invoke the resolved Action against the loaded node. Builds the
 * `IActionContext` exactly like the CLI / bump route (invoker channel
 * fallback, `now`, empty `settings`). The Action stays pure; its
 * returned writes are materialised afterwards by `materializeWrites`.
 */
function invokeAction(
  action: IAction,
  absPath: string,
  node: Node,
  body: IActionBody,
  cwd: string,
): IActionResult<unknown> {
  // `resolveInvokableAction` already guarded `invoke` is a function.
  const invoke = action.invoke!;
  const ctx: IActionContext = {
    node,
    nodeAbsolutePath: absPath,
    invoker: resolveGitAuthorName(cwd) ?? INVOKER_FALLBACK,
    now: () => new Date(),
    settings: {},
  };
  return invoke<Record<string, unknown>, unknown>(body.input ?? {}, ctx);
}

/**
 * Materialise an Action's `sidecar` writes through the consent-gated
 * `FilesystemSidecarStore`. `EConsentRequiredError` is re-thrown so the
 * global `app.onError` maps it to 412 `confirm-required`, and
 * `ESidecarWritersForbiddenError` so it maps to 403
 * `sidecar-writers-forbidden`; any other failure surfaces as a 500.
 */
async function materializeWrites(
  writes: TActionWrite[] | undefined,
  body: IActionBody,
  cwd: string,
): Promise<void> {
  const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
  try {
    for (const w of writes ?? []) {
      if (w.kind === 'sidecar') {
        await store.applyPatch(w.path, w.changes, {
          confirm: body.confirm === true,
          always: body.always === true,
          cwd,
        });
      }
    }
  } catch (err) {
    if (err instanceof EConsentRequiredError) throw err;
    if (err instanceof ESidecarWritersForbiddenError) throw err;
    throw new HTTPException(500, { message: formatErrorMessage(err) });
  }
}

function buildEnvelope(
  actionId: string,
  nodePath: string,
  report: unknown,
  startedAt: number,
): IActionAppliedEnvelope {
  return {
    schemaVersion: '1',
    kind: ENVELOPE_KIND,
    value: { actionId, nodePath, report },
    elapsedMs: Date.now() - startedAt,
  };
}
