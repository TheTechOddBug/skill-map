/**
 * Shared node-by-path loader for the mutating BFF routes.
 *
 * Extracted from `routes/sidecar.ts` (Step 9.6.5) so the generic
 * action-dispatch route (`routes/actions.ts`, Step 17) and the legacy
 * sidecar bump route can resolve a persisted node the same way: open
 * the project DB read-only via `tryWithSqlite`, scan the persisted node
 * list, return the matching row. 404 when the DB is missing OR the node
 * is not in the persisted scan, same client-facing semantics as
 * `/api/nodes/:pathB64`.
 *
 * The body-supplied `nodePath` is sanitised before it is interpolated
 * into the 404 envelope so ANSI escapes / control chars can't repaint a
 * terminal tailing the BFF's stderr-mirrored error log (mirrors the
 * contributions route at L5, audit L3).
 */

// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import type { Node } from '../../kernel/types.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { decodeNodePath, PathCodecError } from '../path-codec.js';
import type { IRouteDeps } from './deps.js';

/**
 * Decode a `:pathB64` route param, translating a malformed value into
 * the 404 `not-found` envelope (from the client's view there's no such
 * node either way, same posture as `/api/nodes/:pathB64`). Shared by the
 * per-node sub-resource routes (`findings`, `prob-extensions`, `jobs`).
 */
export function decodePathB64Or404(pathB64: string): string {
  try {
    return decodeNodePath(pathB64);
  } catch (err) {
    if (err instanceof PathCodecError) {
      throw new HTTPException(404, { message: SERVER_TEXTS.pathB64Malformed });
    }
    throw err;
  }
}

/**
 * Load the persisted node by its scope-relative path. Mirrors the
 * single-node lookup in `sm bump`: open the DB read-only, scan the
 * persisted node list, return the matching row.
 */
export async function loadNode(deps: IRouteDeps, nodePath: string): Promise<Node> {
  const persisted = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    async (adapter) => adapter.scans.load(),
  );
  const node = persisted?.nodes.find((n) => n.path === nodePath);
  if (!node) {
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
    });
  }
  return node;
}
