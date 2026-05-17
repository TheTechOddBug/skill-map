/**
 * `.skillmapignore` file I/O for the BFF's project-ignore route.
 *
 *   - `readPatterns(cwd)`: returns the active patterns (trimmed) found
 *     in `<cwd>/.skillmapignore`. Comments (`# ...`) and blank lines
 *     are dropped at the read boundary; the UI shows a flat list of
 *     items.
 *   - `writePatterns(cwd, patterns)`: round-trips the file preserving
 *     any comments + blank lines from the prior content. Patterns that
 *     disappear from `patterns` are removed in-place; patterns that
 *     already existed keep their original position; new patterns
 *     append at the end. The file always ends with a trailing newline.
 *
 * The kernel side that consumes the file (`src/kernel/scan/ignore.ts`)
 * reads it as raw text and hands it to the `ignore` library; both
 * surfaces use UTF-8. CRLF input is tolerated, the writer emits LF.
 *
 * Not a config-layer concern. `.skillmapignore` is its own artifact
 * (gitignore-syntax, project-root sibling of `.gitignore`), so the
 * helper bypasses `core/config/helper:writeConfigValue` and writes
 * directly to disk.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IGNORE_FILENAME = '.skillmapignore';

export function readPatterns(cwd: string): string[] {
  const path = resolve(cwd, IGNORE_FILENAME);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/**
 * Persist `nextPatterns` into `<cwd>/.skillmapignore`, preserving
 * comments and blank lines that were already in the file. Patterns
 * already present keep their original position (trimmed); patterns
 * that disappeared are dropped along with their original line;
 * patterns new to `nextPatterns` append at the end.
 *
 * Caller is responsible for upstream validation: the helper trusts
 * that every entry in `nextPatterns` is a non-empty single-line
 * string with no control characters. Duplicates inside `nextPatterns`
 * are folded into one entry (set-equality), matching the runtime
 * semantics of the `ignore` library.
 */
export function writePatterns(cwd: string, nextPatterns: readonly string[]): void {
  const path = resolve(cwd, IGNORE_FILENAME);
  const prior = existsSync(path) ? safeRead(path) : '';
  const content = buildContent(prior, nextPatterns);
  writeFileSync(path, content, 'utf8');
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Walk the prior file line by line: keep noise (comments + blanks) in
 * place, keep pattern lines whose trimmed value still appears in
 * `nextPatterns`, drop the others. Append patterns from `nextPatterns`
 * that the prior file did not carry. Always emit a trailing newline.
 */
export function buildContent(prior: string, nextPatterns: readonly string[]): string {
  const wanted = new Set(nextPatterns);
  const kept = new Set<string>();
  const outLines: string[] = [];

  for (const line of splitLines(prior)) {
    pushPriorLine(line, wanted, kept, outLines);
  }
  appendNewPatterns(nextPatterns, kept, outLines);

  return outLines.length === 0 ? '' : outLines.join('\n') + '\n';
}

/**
 * Split `prior` into lines normalising CRLF -> LF, then drop the
 * single trailing empty entry that `String.split` produces when the
 * input ends with a newline. Called for every write; the trailing
 * newline is re-added unconditionally by `buildContent`.
 */
function splitLines(prior: string): string[] {
  if (prior.length === 0) return [];
  const lines = prior.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Classify one prior-file line and push it into `outLines`:
 *   - comment / blank: kept verbatim (preserves layout).
 *   - pattern still in the new list: kept (trimmed) and marked as
 *     handled in `kept` so it doesn't append twice.
 *   - pattern absent from the new list: dropped (operator removed it).
 */
function pushPriorLine(
  line: string,
  wanted: ReadonlySet<string>,
  kept: Set<string>,
  outLines: string[],
): void {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    outLines.push(line);
    return;
  }
  if (wanted.has(trimmed)) {
    outLines.push(trimmed);
    kept.add(trimmed);
  }
}

/**
 * Patterns absent from the prior file land at the end (post-comments)
 * in the order the operator provided them. Already-`kept` entries are
 * skipped so the same pattern never lands twice.
 */
function appendNewPatterns(
  nextPatterns: readonly string[],
  kept: Set<string>,
  outLines: string[],
): void {
  for (const p of nextPatterns) {
    if (kept.has(p)) continue;
    outLines.push(p);
    kept.add(p);
  }
}
