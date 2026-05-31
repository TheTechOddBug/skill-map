/**
 * Kernel walker. Discovers files inside one or more scope roots,
 * reads each, parses it via the configured parser, and yields
 * `IRawNode` records the orchestrator consumes.
 *
 * Owns the audit-cleared defences (every Provider that uses the walker
 * inherits these, no duplication needed in `Provider.walk`):
 *
 *   - **Symlinks (audit M7)**, `entry.isSymbolicLink()` is checked
 *     explicitly and the entry is skipped. Without this guard we relied
 *     on `Dirent.isFile()` returning false for symlinks, which is an
 *     implementation detail of node's `withFileTypes`. The explicit
 *     skip is both self-documenting and resilient to future Dirent API
 *     changes. DECISION (2026-05-31): there is deliberately NO
 *     follow-symlinks option. A `scan.followSymlinks` config key plus a
 *     reserved walker option once existed but were removed as unused
 *     chrome (symlinks have always been hard-skipped, the knob never did
 *     anything). Re-add a follow path ONLY when a user actually asks for
 *     it, and ONLY with cycle detection + realpath-resolved containment,
 *     never a bare `true`.
 *   - **TOCTOU race (audit M7 / H1)**, `readdir` reports a regular file →
 *     `lstat()` re-verifies before the read. Closes the window where the
 *     entry could be swapped for a symlink between the two calls.
 *     `lstat` does NOT follow symlinks (H1 fix, audit upgrade from
 *     `stat`), so a `.md`→symlink race is rejected by `isFile()`
 *     returning false on the symlink itself; non-regular types
 *     (socket, FIFO, device) introduced in the race window are
 *     rejected the same way.
 *   - **Ignore filter**, every directory and file's path-relative-to-
 *     root is checked against the project's `IIgnoreFilter`. When the
 *     caller does not supply one, the walker falls back to bundled
 *     defaults via `buildIgnoreFilter()` so direct test invocations
 *     keep working without an explicit filter argument.
 *
 * Parser dispatch is by id: the walker resolves `options.parser`
 * against the kernel-internal parser registry once at the start of the
 * walk and throws `UnknownParserError` for unknown ids. Built-in
 * parsers ship with the kernel (`frontmatter-yaml`, `plain`); the set
 * is closed by design.
 */

import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { IRawNode } from '../extensions/provider.js';
import { buildIgnoreFilter, type IIgnoreFilter } from './ignore.js';
import { getParser } from './parsers/index.js';

export interface IWalkContentOptions {
  /**
   * File extensions the walker yields. Strings include the leading dot
   * (e.g. `'.md'`, `'.mdc'`, `'.toml'`). Match is suffix-based; the
   * extension comparison is case-sensitive, Providers MUST list every
   * casing they want to match (today the kernel emits lowercase only,
   * matching the on-disk convention of every supported Provider).
   */
  extensions: readonly string[];
  /**
   * Parser id from the kernel-internal registry. Built-ins:
   * `'frontmatter-yaml'`, `'plain'`. Unknown ids throw at the start of
   * the walk; the orchestrator surfaces this as a Provider issue with
   * status `invalid-manifest`.
   */
  parser: string;
  /**
   * Project ignore filter. When omitted the walker uses the bundled
   * defaults (`buildIgnoreFilter()` with no extra layers), keeping
   * direct test invocations working without ceremony. Production callers
   * (the orchestrator) always pass a fully-composed filter.
   */
  ignoreFilter?: IIgnoreFilter;
  /**
   * Mirror of `scan.maxFileSizeBytes`. When set, the walker skips any
   * regular file whose on-disk size exceeds this many bytes BEFORE
   * reading it (the existing TOCTOU `lstat` already supplies the size,
   * so the check costs zero extra syscalls). The skipped file is never
   * read, parsed, or yielded; `onOversizedFile` (when provided) is
   * invoked with its root-relative path and byte size. Absent → no
   * size limit (every matching file is read).
   */
  maxFileSizeBytes?: number;
  /**
   * Callback fired once per file skipped because it exceeded
   * `maxFileSizeBytes`. Receives the root-relative, forward-slash path
   * (same form as the yielded node paths) plus the file's byte size.
   * The orchestrator threads a collector here so the skipped files reach
   * `ScanResult.oversizedFiles`. No-op when omitted.
   */
  onOversizedFile?: (info: { path: string; bytes: number }) => void;
}

export class UnknownParserError extends Error {
  constructor(parserId: string) {
    super(`Unknown parser id '${parserId}'. Built-in parsers: 'frontmatter-yaml', 'plain'.`);
    this.name = 'UnknownParserError';
  }
}

/**
 * Walk the given roots and yield one `IRawNode` per matching file.
 * Async generator so large scopes don't buffer in memory.
 */
export async function* walkContent(
  roots: readonly string[],
  options: IWalkContentOptions,
): AsyncIterable<IRawNode> {
  const parser = getParser(options.parser);
  if (!parser) throw new UnknownParserError(options.parser);
  const filter: IIgnoreFilter = options.ignoreFilter ?? buildIgnoreFilter();
  const extensions = options.extensions;
  const sizeLimit = buildSizeLimit(options);
  for (const root of roots) {
    for await (const file of walkRoot(root, root, filter, extensions, sizeLimit)) {
      const relPath = relative(root, file).split(sep).join('/');
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        // silently skip unreadable files
        continue;
      }
      const parsed = parser.parse(raw, relPath);
      yield {
        path: relPath,
        body: parsed.body,
        frontmatterRaw: parsed.frontmatterRaw,
        frontmatter: parsed.frontmatter,
        // Audit L1: forward parser diagnostics (e.g. malformed YAML)
        // through the IRawNode surface so the orchestrator can
        // convert them into warn-level kernel `Issue` rows. Omitted
        // when the parser reported no issues (happy path).
        ...(parsed.issues && parsed.issues.length > 0 ? { parseIssues: parsed.issues } : {}),
      };
    }
  }
}

/**
 * File-size guard threaded from `walkContent` options into `walkRoot`.
 * Mirror of `scan.maxFileSizeBytes` + its collector callback. Bundled
 * so `walkRoot`'s signature stays short and the recursion threads one
 * reference instead of two parameters per level.
 */
interface IWalkSizeLimit {
  maxFileSizeBytes?: number;
  onOversizedFile?: (info: { path: string; bytes: number }) => void;
}

/**
 * Lift the file-size knobs off `IWalkContentOptions` into the bundled
 * guard `walkRoot` consumes. Only sets each key when present so
 * `exactOptionalPropertyTypes` stays satisfied, and keeps `walkContent`
 * itself under the complexity cap.
 */
function buildSizeLimit(options: IWalkContentOptions): IWalkSizeLimit {
  const sizeLimit: IWalkSizeLimit = {};
  if (options.maxFileSizeBytes !== undefined) {
    sizeLimit.maxFileSizeBytes = options.maxFileSizeBytes;
  }
  if (options.onOversizedFile) sizeLimit.onOversizedFile = options.onOversizedFile;
  return sizeLimit;
}

// Recursive directory walker: per-entry branches over symlink /
// ignore-filter / kind (dir vs file) / extension allow-list. The
// branching IS the walker; extraction yields helpers that all run
// once per entry anyway. Per `context/lint.md` category 7 (recursive type-discriminator walkers).
// eslint-disable-next-line complexity
async function* walkRoot(
  root: string,
  current: string,
  filter: IIgnoreFilter,
  extensions: readonly string[],
  sizeLimit: IWalkSizeLimit,
): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    const full = join(current, name);
    const rel = relative(root, full).split(sep).join('/');
    if (filter.ignores(rel)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      yield* walkRoot(root, full, filter, extensions, sizeLimit);
    } else if (entry.isFile() && hasMatchingExtension(name, extensions)) {
      // TOCTOU re-check (audit H1): readdir reported a regular file;
      // re-verify before reading. We use `lstat` (NOT `stat`) so a
      // symlink swapped in between `readdir` and the re-check is
      // detected here. `stat` follows symlinks, which would have let an
      // attacker race a benign `.md` → symlink to `~/.ssh/id_rsa` and
      // see the target's contents land in the SQLite body store and
      // /api/nodes response. `lstat` plus the `isFile()` predicate
      // rejects both symlinks and any non-regular type (socket, FIFO,
      // device) that appeared in the race window.
      try {
        const s = await lstat(full);
        if (!s.isFile()) continue;
        // File-size skip (`scan.maxFileSizeBytes`). The `lstat` above
        // already supplies `s.size`, so the guard costs zero extra
        // syscalls. A file over the limit is reported and skipped here
        // BEFORE the orchestrator ever reads it: an accidental binary
        // drop or generated artefact never lands in the body store.
        if (
          sizeLimit.maxFileSizeBytes !== undefined &&
          s.size > sizeLimit.maxFileSizeBytes
        ) {
          sizeLimit.onOversizedFile?.({ path: rel, bytes: s.size });
          continue;
        }
        yield full;
      } catch {
        // silently skip unreadable files
      }
    }
  }
}

function hasMatchingExtension(name: string, extensions: readonly string[]): boolean {
  for (const ext of extensions) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}
