/**
 * `GET /api/graph?format=ascii|json|md`, render the persisted graph
 * through a registered formatter.
 *
 * Default `format=ascii`, the only built-in formatter at v0.5.0.
 * `mermaid` and `dot` arrive at Step 12 as drop-in additions; the route
 * picks them up automatically once they ship as built-ins.
 *
 * Content-type per format:
 *
 *   - `ascii` → `text/plain; charset=utf-8`
 *   - `md`    → `text/markdown; charset=utf-8`
 *   - `json`  → `application/json; charset=utf-8`
 *   - other (auto-detected from formatter id) → `text/plain; charset=utf-8`
 *
 * Unknown `format` (no formatter registered with that `formatId`) →
 * 400 `bad-query` with the available formats listed.
 *
 * Plugin warnings are surfaced exactly once, at `sm serve` boot
 * (`server/index.ts: assembleBootBundle`). The route reuses that
 * cached bundle and never re-logs.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { composeFormatters } from '../../core/runtime/plugin-runtime.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IRouteDeps } from './deps.js';

const DEFAULT_FORMAT = 'ascii';
/**
 * Formatter-id alphabet (lowercase a-z, 0-9, hyphen). Mirrors the
 * built-in formatter ids (`ascii`, `json`, `md`, `mermaid`, `dot`)
 * and the future-friendly hyphen case (`graph-viz` etc.). Capped at
 * 32 chars so a hostile `?format=` value cannot stretch the error
 * envelope or interpolate a large string into the message catalog.
 * Audit m4, validated BEFORE the formatter registry lookup.
 */
const FORMAT_ID_PATTERN = /^[a-z0-9-]+$/;
const FORMAT_ID_MAX = 32;

export function registerGraphRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/graph', async (c) => {
    const format = c.req.query('format') ?? DEFAULT_FORMAT;
    if (format.length > FORMAT_ID_MAX || !FORMAT_ID_PATTERN.test(format)) {
      throw new HTTPException(400, {
        // Sanitize defensively, the regex above already rejects ANSI
        // and control bytes, but the message interpolates user input
        // and the BFF mirrors error envelopes into the server log.
        message: tx(SERVER_TEXTS.graphFormatMalformed, {
          value: sanitizeForTerminal(format),
        }),
      });
    }

    // M3: reuse the boot-cached pluginRuntime; warnings already
    // logged once at `assembleBootBundle`. Re-discovering per request
    // would re-walk the FS, re-compile AJV validators, and re-log
    // every warning N times under load.
    const formatters = composeFormatters({
      noBuiltIns: deps.options.noBuiltIns,
      pluginRuntime: deps.pluginRuntime,
    });
    const formatter = formatters.find((f) => f.formatId === format);
    if (!formatter) {
      const available = formatters
        .map((f) => f.formatId)
        .sort()
        .join(', ');
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.graphUnknownFormat, {
          format,
          available: available || '(none)',
        }),
      });
    }

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.scans.load(),
    );
    const text = renderGraphPayload(formatter, loaded);
    const body = text.endsWith('\n') ? text : text + '\n';
    return c.body(body, 200, { 'content-type': contentTypeFor(format) });
  });
}

/**
 * Materialise the formatter context from the optionally-loaded scan
 * and run the formatter. Pulled out of the route handler so its
 * cyclomatic count stays under the project cap (the conditional spread
 * for `scanResult` pushes the inline form over the limit). The
 * built-in `json` formatter projects `scanResult` verbatim when
 * present; other formatters ignore the optional field and consume
 * only the three primary arrays.
 */
function renderGraphPayload(
  formatter: {
    format: (ctx: import('../../kernel/extensions/index.js').IFormatterContext) => string;
    resolvedSettings?: Record<string, unknown>;
  },
  loaded: import('../../kernel/types.js').ScanResult | null,
): string {
  const scan = loaded ?? { nodes: [], links: [], issues: [] };
  const settings = formatter.resolvedSettings ?? {};
  if (loaded === null) {
    return formatter.format({ nodes: scan.nodes, links: scan.links, issues: scan.issues, settings });
  }
  return formatter.format({
    nodes: scan.nodes,
    links: scan.links,
    issues: scan.issues,
    settings,
    scanResult: loaded,
  });
}

function contentTypeFor(format: string): string {
  if (format === 'json') return 'application/json; charset=utf-8';
  if (format === 'md' || format === 'markdown' || format === 'mermaid') {
    return 'text/markdown; charset=utf-8';
  }
  return 'text/plain; charset=utf-8';
}
