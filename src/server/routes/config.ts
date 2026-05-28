/**
 * `GET /api/config`, merged effective config (defaults → user → user-local
 * → project → project-local → override).
 *
 * Wraps `loadConfig` from `kernel/config/loader.ts`. Returns the
 * `effective` object inside an `IValueEnvelope` so the SPA gets a
 * stable `{ schemaVersion, kind, value }` shape.
 *
 * Warnings emitted by the layered loader (malformed JSON, schema
 * violations) are forwarded to `process.stderr`, they do NOT reach the
 * client response. Read parity with `sm config list`: warnings are
 * informational at the operator level, not user-facing on every request.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { buildValueEnvelope } from '../envelope.js';
import type { IRouteDeps } from './deps.js';

export function registerConfigRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/config', (c) => {
    let loaded;
    try {
      // Cached layered-config view, no per-request `loadConfig`
      // walk. Mutating routes invalidate the cache via
      // `configService.reload()` so the next read sees the new state.
      loaded = deps.configService.get();
    } catch (err) {
      // `--strict` mode would throw; the BFF never enables strict so this
      // path normally never trips. If it does (config FS read failed
      // hard), surface it as `internal` so the SPA shows a generic
      // failure instead of silently rendering empty defaults.
      throw new HTTPException(500, { message: formatErrorMessage(err) });
    }
    for (const warn of loaded.warnings) {
      log.warn(sanitizeForTerminal(warn));
    }
    return c.json(
      buildValueEnvelope(
        'config',
        loaded.effective,
        deps.kindRegistry,
        deps.providerRegistry,
        deps.contributionsRegistry,
      ),
    );
  });
}
