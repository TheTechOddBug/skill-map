/**
 * Per-node and per-spawn activity detail (see
 * `spec/provider-activity.md` §Execution stats + §Conversation capture):
 *
 *   - `GET /api/activity/node/:pathB64` → `{ stats, recent, spawns,
 *     captureEnabled }` for the inspector's Activity section. The path
 *     param follows the exact base64url convention of
 *     `GET /api/nodes/:pathB64` (malformed → 404, same as unknown). A
 *     path that is not a scanned node → 404; a scanned node with no
 *     recorded activity → zeroed stats, never 404.
 *   - `GET /api/activity/spawns/:spawnId` → one spawn record (the
 *     spawn-edge click surface), 404 for an unknown id.
 *
 * Both are loopback-gated like every `/api/*` route and take NO
 * serve.json token (operator UI surface). Spawn records serve metadata
 * always; the conversation halves (`prompt` / `response`) are stripped
 * whenever the capture gate is off (`captureEnabled` rides every
 * response so the SPA can explain the gap). While the gate is off the
 * store is empty anyway (recording is a no-op and disabling clears),
 * so the strip is defence in depth, not the primary gate.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import type {
  ActivityConversationStore,
  IConversationRecord,
} from '../activity-conversations.js';
import type { ActivityStatsService } from '../activity-stats.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { decodeNodePath, PathCodecError } from '../path-codec.js';
import type { IRouteDeps } from './deps.js';

export interface IActivityDetailRouteDeps extends IRouteDeps {
  /** Boot-scoped stats accumulator (composition-root owned). */
  stats: ActivityStatsService;
  /**
   * Consent-gated conversation store. Explicit extra dep by custody
   * contract (never on `IRouteDeps`, see `activity-conversations.ts`).
   */
  conversations: ActivityConversationStore;
}

export function registerActivityDetailRoutes(
  app: Hono,
  deps: IActivityDetailRouteDeps,
): void {
  app.get('/api/activity/node/:pathB64', async (c) => {
    const nodePath = decodePathParamOr404(c.req.param('pathB64'));
    const exists = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => (await adapter.scans.findNode(nodePath)) !== null,
    );
    if (exists !== true) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }
    const detail = deps.stats.nodeDetail(nodePath);
    const captureEnabled = deps.conversations.enabled;
    const spawns = deps.conversations
      .byNode(nodePath)
      .map((record) => projectRecord(record, captureEnabled));
    return c.json({ stats: detail.stats, recent: detail.recent, spawns, captureEnabled });
  });

  app.get('/api/activity/spawns/:spawnId', (c) => {
    const spawnId = c.req.param('spawnId');
    const record = deps.conversations.bySpawnId(spawnId);
    if (!record) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.activitySpawnUnknown, {
          spawnId: sanitizeForTerminal(spawnId),
        }),
      });
    }
    const captureEnabled = deps.conversations.enabled;
    return c.json({ spawn: projectRecord(record, captureEnabled), captureEnabled });
  });
}

/**
 * Mirror of the `GET /api/nodes/:pathB64` decode convention: malformed
 * base64url surfaces as 404 (from the client's view there's no such
 * node either way).
 */
function decodePathParamOr404(pathB64: string): string {
  try {
    return decodeNodePath(pathB64);
  } catch (err) {
    if (err instanceof PathCodecError) {
      throw new HTTPException(404, { message: SERVER_TEXTS.pathB64Malformed });
    }
    throw err;
  }
}

/** Metadata-only projection while the gate is off; verbatim copy when on. */
function projectRecord(
  record: IConversationRecord,
  captureEnabled: boolean,
): IConversationRecord {
  if (captureEnabled) return record;
  const { prompt: _prompt, response: _response, ...metadata } = record;
  return metadata;
}
