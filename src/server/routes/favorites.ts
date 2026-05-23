/**
 * `PUT /api/favorites/:pathB64`    , mark the node as favorited.
 * `DELETE /api/favorites/:pathB64` , drop the favorite.
 *
 * Both verbs are idempotent and return `204 No Content` on success
 * (no envelope; clients update local state optimistically and don't
 * need a payload back). Path resolution is the same `decodeNodePath`
 * helper the single-node route uses; a malformed `pathB64` or a path
 * not present in the live `scan_nodes` snapshot surfaces as `404 not-found`
 * via the global `app.onError`.
 *
 * Storage routes through `port.favorites.{set,unset}` against
 * `state_node_favorites` (zone `state_`). No SQL JOIN against
 * `scan_nodes`, the per-request `GET /api/nodes` decorator loads the
 * full path set into memory once and decorates by `Set` membership
 * (see `routes/nodes.ts`).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { decodeNodePath, PathCodecError } from '../path-codec.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IRouteDeps } from './deps.js';

export function registerFavoritesRoutes(app: Hono, deps: IRouteDeps): void {
  app.put('/api/favorites/:pathB64', async (c) => {
    const nodePath = decodePath(c.req.param('pathB64'));
    const result = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const node = await adapter.scans.findNode(nodePath);
        if (!node) return { found: false };
        await adapter.favorites.set(nodePath);
        return { found: true };
      },
    );
    // `tryWithSqlite` returns null when the DB file does not exist,
    // there's no scan, so no node, so 404. Same outcome as a missing
    // path in an existing DB.
    if (!result || !result.found) {
      // Sanitise the body-supplied path before interpolating it into the
      // 404 envelope so ANSI escapes / control chars in a hostile
      // `:pathB64` cannot repaint a terminal tailing the BFF error log
      // (audit L1). Mirrors `sidecar.ts:287`.
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }
    return c.body(null, 204);
  });

  app.delete('/api/favorites/:pathB64', async (c) => {
    const nodePath = decodePath(c.req.param('pathB64'));
    // No existence check on DELETE, un-favoriting a path the kernel
    // no longer knows about (deleted file, stale URL) is a no-op,
    // matching the table's "absence-of-row = not favorited" semantics.
    await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => adapter.favorites.unset(nodePath),
    );
    return c.body(null, 204);
  });
}

function decodePath(pathB64: string): string {
  try {
    return decodeNodePath(pathB64);
  } catch (err) {
    if (err instanceof PathCodecError) {
      throw new HTTPException(404, { message: SERVER_TEXTS.pathB64Malformed });
    }
    throw err;
  }
}
