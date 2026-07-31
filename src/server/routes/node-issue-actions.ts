/**
 * Per-issue mutation routes for the inspector's deterministic-issue
 * dismiss affordance (`spec/cli-contract.md` §Serve route table):
 *
 *   - `POST /api/nodes/:pathB64/issues/dismiss`   -> `sm issues dismiss`
 *   - `POST /api/nodes/:pathB64/issues/undismiss` -> `sm issues undismiss`
 *
 * Both are SIDECAR writes riding the same gated channel as the
 * finding-action routes (`writeIssueSuppressions`, one shared writer
 * with the MCP tools): a missing standing consent surfaces as the
 * global `412` `confirm-required` envelope
 * (`details.key = 'allowEditSmFiles'`); an `always` grant persists and
 * the config cache reloads. Unlike the findings read-time lens, issue
 * suppressions apply at EMISSION time (`spec/db-schema.md`
 * §scan_issues): dismiss also DELETES the matching persisted
 * `scan_issues` rows so every read agrees without a rescan, and
 * undismiss has nothing to reveal instantly (the issue reappears at the
 * NEXT scan, the documented asymmetry). The analyzer id lands VERBATIM
 * as the client sent it (the UI sends the SHORT id; matching accepts
 * both spellings, so no `core/` prefixing here).
 *
 * Malformed `pathB64`, unknown node, or missing DB -> `404`. Undismiss
 * with no matching entry -> `409` `issue-suppression-not-found`
 * (self-healing the mirror from the live `.sm` first, same posture as
 * the findings undismiss route). Success `204 No Content`.
 *
 * DISMISS additionally refuses an `analyzer` the live catalog does not
 * know -> `400` `bad-query`, BEFORE any side effect (no `.sm` write, no
 * `scan_issues` delete, no operations-log line), mirroring the CLI's
 * exit 2. See `assertKnownAnalyzer` for why the gate is asymmetric.
 */

import { resolve } from 'node:path';

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { appendOperation } from '../../core/operations-log.js';
import {
  analyzerCatalogFrom,
  validateAnalyzerFilter,
} from '../../core/runtime/analyzer-catalog.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import {
  buildIssueSuppressionEntry,
  existingIssueSuppressions,
  mergeIssueSuppression,
  readSidecarFor,
  removeIssueSuppression,
} from '../../kernel/sidecar/index.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { ConflictError } from '../app.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import {
  refreshAnnotationsMirror,
  writeIssueSuppressions,
} from '../util/issue-suppression-write.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';
import { decodePathB64Or404 } from './node-loader.js';

/**
 * Narrow bag, mirror of the finding-actions routes: the issue table +
 * node lookup (`options.dbPath`), the project tree for the sidecar
 * write (`runtimeContext.cwd`), the config cache reload after a
 * persisted `always` grant (`configService`), and the live extension
 * set the dismiss gate validates `body.analyzer` against
 * (`pluginRuntimeHolder`).
 */
export type TIssueActionsRouteDeps = Pick<
  IRouteDeps,
  'options' | 'configService' | 'runtimeContext' | 'pluginRuntimeHolder'
>;

interface IIssueDismissBody {
  analyzer: string;
  value: string;
  note?: string;
  confirm?: boolean;
  always?: boolean;
}

interface IIssueUndismissBody {
  analyzer: string;
  value: string;
  confirm?: boolean;
  always?: boolean;
}

const CONSENT_PROPS = {
  confirm: { type: 'boolean' },
  always: { type: 'boolean' },
} as const;

/** The (analyzer, value) identity pair both bodies require. */
const KEY_PROPS = {
  analyzer: { type: 'string', minLength: 1 },
  value: { type: 'string', minLength: 1 },
} as const;

const KEY_MAPPING = {
  '/analyzer:required': SERVER_TEXTS.issueAnalyzerRequired,
  '/analyzer:type:string': SERVER_TEXTS.issueAnalyzerRequired,
  '/analyzer:minLength': SERVER_TEXTS.issueAnalyzerRequired,
  '/value:required': SERVER_TEXTS.issueValueRequired,
  '/value:type:string': SERVER_TEXTS.issueValueRequired,
  '/value:minLength': SERVER_TEXTS.issueValueRequired,
} as const;

/** Shared AJV-message table (mirror of the finding routes' tone). */
const BODY_MESSAGES = {
  notJson: SERVER_TEXTS.findingBodyNotJson,
  notObject: SERVER_TEXTS.findingBodyNotObject,
  invalid: SERVER_TEXTS.findingBodyNotObject,
  mapping: KEY_MAPPING,
} as const;

const parseDismissBody = makeBodyValidator<IIssueDismissBody>(
  {
    type: 'object',
    required: ['analyzer', 'value'],
    properties: { ...KEY_PROPS, note: { type: 'string' }, ...CONSENT_PROPS },
    additionalProperties: false,
  },
  BODY_MESSAGES,
);

const parseUndismissBody = makeBodyValidator<IIssueUndismissBody>(
  {
    type: 'object',
    required: ['analyzer', 'value'],
    properties: { ...KEY_PROPS, ...CONSENT_PROPS },
    additionalProperties: false,
  },
  BODY_MESSAGES,
);

export function registerNodeIssueActionsRoutes(
  app: Hono,
  deps: TIssueActionsRouteDeps,
): void {
  app.post('/api/nodes/:pathB64/issues/dismiss', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const body = await parseDismissBody(c.req.raw);
    // Typo gate BEFORE the DB is even opened: the write below is
    // COMMITTED human-curation state.
    assertKnownAnalyzer(deps, body.analyzer);
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return null;
        // The entry lands with the analyzer id VERBATIM as sent (short
        // or qualified; `mergeIssueSuppression` dedups across both
        // spellings, so a repeat dismiss is a 204 no-op).
        await writeIssueSuppressions(
          adapter,
          { cwd: deps.runtimeContext.cwd },
          nodePath,
          (entries) =>
            mergeIssueSuppression(
              entries,
              buildIssueSuppressionEntry(body.analyzer, body.value, body.note),
            ),
          { confirm: body.confirm, always: body.always },
        );
        // Emission-time convergence: drop the persisted rows the fresh
        // suppression covers so reads agree without waiting for a rescan.
        const deleted = await adapter.issues.deleteForSuppression(
          nodePath,
          body.analyzer,
          body.value,
        );
        return { deleted };
      },
    );
    if (outcome === null) throw nodeNotFound(nodePath);
    appendOperation(deps.runtimeContext.cwd, {
      op: 'issues.dismiss',
      target: nodePath,
      channel: 'ui',
      outcome: 'ok',
      detail: `analyzer=${body.analyzer} value=${body.value} rows=${outcome.deleted}`,
    });
    reloadOnPersistedGrant(deps, body.always);
    return c.body(null, 204);
  });

  app.post('/api/nodes/:pathB64/issues/undismiss', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const body = await parseUndismissBody(c.req.raw);
    // NO `assertKnownAnalyzer` here, on purpose (same asymmetry as
    // `sm issues undismiss`): this route DELETES an entry, and one
    // legitimate reason an entry is stale is that the plugin owning its
    // analyzer was uninstalled. Refusing an unknown id would trap the
    // operator with committed junk they cannot clean. Read surfaces
    // (`GET /api/nodes/:pathB64`, MCP `list_issue_suppressions`) keep
    // showing such entries for the same reason.
    const outcome = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return 'node-gone';
        const mdAbs = resolve(deps.runtimeContext.cwd, nodePath);
        const entries = existingIssueSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
        if (removeIssueSuppression(entries, body.analyzer, body.value).removed === null) {
          // Self-heal before the 409 (same rule as the findings
          // undismiss): the mirror may claim a suppression the live
          // file no longer carries.
          await refreshAnnotationsMirror(adapter, { cwd: deps.runtimeContext.cwd }, nodePath);
          return 'no-match';
        }
        await writeIssueSuppressions(
          adapter,
          { cwd: deps.runtimeContext.cwd },
          nodePath,
          (all) => removeIssueSuppression(all, body.analyzer, body.value).remaining,
          { confirm: body.confirm, always: body.always },
        );
        return 'removed';
      },
    );
    if (outcome === null || outcome === 'node-gone') throw nodeNotFound(nodePath);
    if (outcome === 'no-match') {
      throw new ConflictError({
        code: 'issue-suppression-not-found',
        message: tx(SERVER_TEXTS.issueSuppressionNotFound, {
          analyzer: sanitizeForTerminal(body.analyzer),
          value: sanitizeForTerminal(body.value),
          node: sanitizeForTerminal(nodePath),
        }),
      });
    }
    appendOperation(deps.runtimeContext.cwd, {
      op: 'issues.undismiss',
      target: nodePath,
      channel: 'ui',
      outcome: 'ok',
      detail: `analyzer=${body.analyzer} value=${body.value}`,
    });
    reloadOnPersistedGrant(deps, body.always);
    return c.body(null, 204);
  });
}

/**
 * Refuse a `body.analyzer` the live catalog does not know, with the
 * standard `400` `bad-query` envelope naming the offending id.
 *
 * Same catalog and same qualified-or-bare grammar as
 * `sm check --analyzers` / `sm issues dismiss`, projected out of the
 * boot-cached plugin runtime the rest of the BFF classifies against
 * (`pluginRuntimeHolder.current`, read per request so a
 * `reloadPluginRuntime` swap reaches this gate too). Built-ins are
 * folded in by `analyzerCatalogFrom`, so the short ids the UI sends
 * (`reference-broken`, a `core` built-in) resolve with no drop-in
 * plugin present.
 *
 * DISMISS ONLY. `undismiss` and every read surface deliberately skip
 * this gate: creating junk is the defect, deleting or listing junk is
 * the feature (see the undismiss handler).
 */
function assertKnownAnalyzer(deps: TIssueActionsRouteDeps, analyzer: string): void {
  const analyzers = analyzerCatalogFrom(deps.pluginRuntimeHolder.current);
  // Single id in, so the shared helper's `unknown` list carries just
  // this one; the message quotes it directly.
  if (validateAnalyzerFilter([analyzer], analyzers) === null) return;
  throw new HTTPException(400, {
    message: tx(SERVER_TEXTS.issueUnknownAnalyzer, {
      analyzer: sanitizeForTerminal(analyzer),
    }),
  });
}

function nodeNotFound(nodePath: string): HTTPException {
  return new HTTPException(404, {
    message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
  });
}

/**
 * After a persisted `always` grant, reload the config cache so
 * subsequent requests see `allowEditSmFiles: true` (mirror of the
 * finding-action routes).
 */
function reloadOnPersistedGrant(deps: TIssueActionsRouteDeps, always: boolean | undefined): void {
  if (always === true) deps.configService.reload();
}
