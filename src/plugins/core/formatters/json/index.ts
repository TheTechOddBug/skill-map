/**
 * `json` formatter. Stringifies the persisted `ScanResult` so
 * `sm graph --format json` is byte-equivalent to `sm scan --json`
 * modulo whitespace. Distinct from the global `--json` flag, which is
 * ignored by `sm graph` (the verb picks formats via `--format`).
 *
 * When the caller passes the full `ScanResult` (via `ctx.scanResult`,
 * the canonical path from `cli/commands/graph.ts` and
 * `server/routes/graph.ts`), the formatter stringifies it verbatim. As
 * a fallback for drivers that still pass only `(nodes, links, issues)`,
 * the formatter synthesises a minimal envelope from those three
 * arrays. The fallback intentionally drops `schemaVersion` /
 * `scannedAt` / `scope` / `roots` / `stats` rather than fabricating
 * them; consumers should rely on the canonical path for spec
 * compliance.
 *
 * The output has NO trailing newline; the calling verb adds one if it
 * needs newline-terminated output (`cli/commands/graph.ts` does).
 */

import type { IFormatter, IFormatterContext } from '../../../../kernel/extensions/index.js';

const ID = 'json';

export const jsonFormatter: IFormatter = {
  id: ID,
  pluginId: 'core',
  kind: 'formatter',
  version: '1.0.0',
  description:
    'Renders the persisted scan as JSON (conforms to `scan-result.schema.json` when the full ScanResult is available). Used by `sm graph --format json` and `GET /api/graph?format=json`.',
  stability: 'stable',
  formatId: ID,

  format(ctx: IFormatterContext): string {
    if (ctx.scanResult !== undefined) {
      return JSON.stringify(ctx.scanResult);
    }
    // Fallback for legacy callers that only pass the three arrays.
    // Keep the shape minimal, the consumer that does not pass
    // `scanResult` knows the envelope is partial.
    return JSON.stringify({
      nodes: ctx.nodes,
      links: ctx.links,
      issues: ctx.issues,
    });
  },
};
