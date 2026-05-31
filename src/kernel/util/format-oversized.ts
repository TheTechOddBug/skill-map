/**
 * Shared formatter for the "skipped oversized file" notices the three
 * scan surfaces emit when the walker drops a file for exceeding
 * `scan.maxFileSizeBytes`:
 *
 *   - `sm scan` (`src/cli/commands/scan.ts`), a multi-line WARN block;
 *   - `sm watch` (`src/cli/commands/watch.ts`), the same block per batch;
 *   - `sm serve` (`src/server/watcher.ts`), one comma-joined log line.
 *
 * All three render the same per-file atom: the root-relative path and the
 * human byte size from `formatBytes`. This module is the single source of
 * that pairing so the three surfaces never drift on size units or row
 * shape.
 *
 * Two layers:
 *
 *   - `formatOversizedFilePair(file)`, the bare `path (size)` atom shared
 *     by every surface. Callers that need to sanitise the path for a TTY
 *     (the serve log line) pass a pre-sanitised path in `file.path`.
 *   - `formatOversizedFileRows(files)`, the CLI WARN-block rows
 *     (`     - path (size)\n`), one string per file, byte-for-byte the
 *     shape `sm scan` and `sm watch` emit. Returns `[]` for an empty list.
 *
 * Pure: no I/O, no side effects, no colour. Sanitisation and stream
 * writes stay at the call site.
 */

import type { OversizedFile } from '../types.js';
import { formatBytes } from './format-bytes.js';

/**
 * The shared `path (humanSize)` atom for one skipped file. The path is
 * used verbatim, callers that flow it to a TTY are responsible for
 * sanitising it first (the serve surface does).
 */
export function formatOversizedFilePair(file: OversizedFile): string {
  return `${file.path} (${formatBytes(file.bytes)})`;
}

/**
 * The CLI WARN-block rows for a list of skipped files, one fully-rendered
 * `     - path (size)\n` string per entry, in input order. This is the
 * exact per-row format `sm scan` (`scanSkippedFileRow`) and `sm watch`
 * (`skippedFileRow`) emit; both surfaces join the result with `''` and
 * splice it into their notice template's `{{files}}` slot. Returns `[]`
 * for an empty list so the caller's `.join('')` yields an empty block.
 */
export function formatOversizedFileRows(files: readonly OversizedFile[]): string[] {
  return files.map((file) => `     - ${formatOversizedFilePair(file)}\n`);
}
