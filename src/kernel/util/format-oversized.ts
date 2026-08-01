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
 *     by every surface, with the path sanitised for terminal output.
 *   - `formatOversizedFileRows(files)`, the CLI WARN-block rows
 *     (`     - path (size)\n`), one string per file, byte-for-byte the
 *     shape `sm scan` and `sm watch` emit. Returns `[]` for an empty list.
 *
 * Pure: no I/O, no side effects, no colour. Stream writes stay at the
 * call site.
 */

import type { OversizedFile } from '../types.js';
import { formatBytes } from './format-bytes.js';
import { sanitizeForTerminal } from './safe-text.js';

/**
 * The shared `path (humanSize)` atom for one skipped file.
 *
 * The path is sanitised HERE rather than by the caller (audit finding,
 * 2026-08-01). It used to be a documented caller obligation, which the
 * serve surface honoured and both CLI surfaces did not: a committed
 * file named `evil<ESC>[2Jname.md` just over `scan.maxFileSizeBytes`
 * cleared the operator's screen on `sm scan` of a fresh clone, and
 * again on every `sm watch` batch. The filename is attacker-authored
 * under clone-and-scan, and every one of the three surfaces writes it
 * to a terminal, so there is no caller for whom the raw string is the
 * right answer. Making it structural means the next surface cannot
 * forget.
 */
export function formatOversizedFilePair(file: OversizedFile): string {
  return `${sanitizeForTerminal(file.path)} (${formatBytes(file.bytes)})`;
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
