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
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { IRawNode } from '../extensions/provider.js';
import { buildIgnoreFilter, type IIgnoreFilter } from './ignore.js';
import { getParser } from './parsers/index.js';
import type { IParseIssue } from './parsers/types.js';

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
   * Optional parsed-frontmatter field that carries the node's markdown
   * body (mirror of `IProviderReadConfig.bodyField`). When set and
   * `frontmatter[bodyField]` is a string, the walker yields that string as
   * the node `body` instead of the parser's own `body` output, so the body
   * hash + every body-scoped extractor see the prose that lives inside
   * structured frontmatter (e.g. an OpenAI Codex agent's TOML
   * `instructions` field). Absent or non-string → the parser's `body` is
   * used unchanged.
   */
  bodyField?: string;
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
  /**
   * Incremental-walk hint: prior-scan file mtimes keyed by root-relative
   * path. On a match against the file's on-disk `mtime` (already supplied
   * by the TOCTOU `lstat`, zero extra syscalls), the walker SKIPS the
   * `readFile` + parse and yields a lightweight `unchanged` record with a
   * lazy `reread`. This is the dominant saving on a re-scan: an unchanged
   * corpus pays a stat per file, not a full read + YAML parse. Absent
   * means "read every file" (the full-scan default).
   */
  priorMtimes?: ReadonlyMap<string, number>;
  /**
   * Scoped-walk hint for the watcher's incremental path: an explicit
   * list of ABSOLUTE file paths to read instead of traversing the
   * roots. When supplied, `walkContent` does NOT call `readdir` / walk
   * the tree at all; it reads ONLY these paths (those that match
   * `extensions`, exist on disk, and pass the size guard) and yields a
   * normal `IRawNode` per match. A scoped path whose extension does not
   * match is skipped (another provider may claim it). This is the
   * traversal-elimination win: a file save re-reads one file rather
   * than `lstat`-ing the whole corpus. Absent → the walker traverses
   * the roots as usual (full-scan + mtime-gate path). When both
   * `scopedPaths` and `priorMtimes` are set, `scopedPaths` wins (the
   * caller already knows exactly what changed, there is nothing to gate).
   */
  scopedPaths?: readonly string[];
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

  const bodyField = options.bodyField;

  // Scoped read (watcher incremental path): the caller handed us the
  // exact list of changed files, so skip the directory traversal
  // entirely and read only those. See `IWalkContentOptions.scopedPaths`.
  if (options.scopedPaths !== undefined) {
    yield* walkScoped(roots, options.scopedPaths, extensions, sizeLimit, parser, bodyField);
    return;
  }

  for (const root of roots) {
    for await (const entry of walkRoot(root, root, filter, extensions, sizeLimit)) {
      const relPath = relative(root, entry.full).split(sep).join('/');
      const rec = await traversedEntryToNode(
        entry,
        relPath,
        options.priorMtimes,
        parser,
        bodyField,
      );
      if (rec !== null) yield rec;
    }
  }
}

/**
 * Turn one traversed `IWalkEntry` into the `IRawNode` to yield, or `null`
 * when the file is unreadable (silently skipped). Splits the two branches
 * the traversal loop used to inline: the mtime-match `unchanged` fast path
 * (yields a lightweight record whose body is read lazily) versus the full
 * read + parse path. Keeps `walkContent` itself under the complexity cap.
 */
async function traversedEntryToNode(
  entry: IWalkEntry,
  relPath: string,
  priorMtimes: ReadonlyMap<string, number> | undefined,
  parser: ReturnType<typeof getParser>,
  bodyField: string | undefined,
): Promise<IRawNode | null> {
  // Incremental fast path: the file's mtime matches the prior scan, so
  // its body is byte-identical. Skip the read + parse (the dominant
  // per-file cost) and yield a lightweight `unchanged` record. The
  // orchestrator reuses the prior node and calls `reread` only if a
  // sidecar edit forces re-extraction.
  const priorMtime = priorMtimes?.get(relPath);
  if (priorMtime !== undefined && priorMtime === entry.modifiedAtMs) {
    return buildUnchangedRecord(entry.full, relPath, entry.modifiedAtMs, parser, bodyField);
  }

  const parsed = await readAndParse(entry.full, relPath, parser, bodyField);
  if (parsed === null) return null; // unreadable, silently skipped
  return {
    path: relPath,
    body: parsed.body,
    frontmatterRaw: parsed.frontmatterRaw,
    frontmatter: parsed.frontmatter,
    // File mtime from the TOCTOU `lstat` (zero extra syscalls).
    // Threaded onto the persisted `Node` as `modifiedAtMs`.
    modifiedAtMs: entry.modifiedAtMs,
    // Audit L1: forward parser diagnostics (e.g. malformed YAML)
    // through the IRawNode surface so the orchestrator can
    // convert them into warn-level kernel `Issue` rows. Omitted
    // when the parser reported no issues (happy path).
    ...(parsed.parseIssues ? { parseIssues: parsed.parseIssues } : {}),
  };
}

/**
 * Build the lightweight `unchanged` record the mtime fast path yields. The
 * body / frontmatter are empty placeholders; the real read + parse is
 * deferred to the lazy `reread`, which shares `readAndParse` with the eager
 * path and degrades to empty content when the file vanished mid-scan.
 */
function buildUnchangedRecord(
  full: string,
  relPath: string,
  modifiedAtMs: number,
  parser: ReturnType<typeof getParser>,
  bodyField: string | undefined,
): IRawNode {
  return {
    path: relPath,
    body: '',
    frontmatterRaw: '',
    frontmatter: {},
    modifiedAtMs,
    unchanged: true,
    reread: async () => {
      const re = await readAndParse(full, relPath, parser, bodyField);
      // `null` => the file vanished between the walk and the reread
      // (rare race). Degrade to empty content so the re-extract pass
      // emits nothing for it rather than throwing mid-batch.
      return re ?? { body: '', frontmatterRaw: '', frontmatter: {} };
    },
  };
}

/**
 * Scoped read path: yield one `IRawNode` per explicit absolute path
 * that matches `extensions`, still exists on disk, and passes the size
 * guard. NO directory traversal: this is the watcher's incremental win,
 * a save re-reads only the changed file(s) rather than `lstat`-ing the
 * whole corpus. Each path is resolved RELATIVE to the first root that
 * contains it so the yielded `path` is the same root-relative POSIX form
 * the traversal path emits (and the same form prior `node.path` carries).
 * A path under none of the roots, or whose extension does not match, is
 * skipped (another provider may claim it on its own scoped walk).
 */
async function* walkScoped(
  roots: readonly string[],
  scopedPaths: readonly string[],
  extensions: readonly string[],
  sizeLimit: IWalkSizeLimit,
  parser: ReturnType<typeof getParser>,
  bodyField: string | undefined,
): AsyncIterable<IRawNode> {
  const absRoots = roots.map((r) => (isAbsolute(r) ? r : resolve(r)));
  for (const scoped of scopedPaths) {
    const rec = await scopedPathToNode(scoped, absRoots, extensions, sizeLimit, parser, bodyField);
    if (rec !== null) yield rec;
  }
}

/**
 * Turn one scoped absolute path into the `IRawNode` to yield, or `null`
 * when it should be skipped (outside every root, extension mismatch,
 * vanished, non-regular, oversized, or unreadable). Splits the per-path
 * work out of `walkScoped` so that loop body stays a one-line dispatch.
 */
async function scopedPathToNode(
  scoped: string,
  absRoots: readonly string[],
  extensions: readonly string[],
  sizeLimit: IWalkSizeLimit,
  parser: ReturnType<typeof getParser>,
  bodyField: string | undefined,
): Promise<IRawNode | null> {
  const full = isAbsolute(scoped) ? scoped : resolve(scoped);
  const relPath = relativeFromRoots(full, absRoots);
  if (relPath === null) return null; // outside every root
  if (!hasMatchingExtension(full, extensions)) return null; // not this provider's
  const s = await statRegularFile(full, relPath, sizeLimit);
  if (s === null) return null; // vanished, non-regular, or oversized
  const parsed = await readAndParse(full, relPath, parser, bodyField);
  if (parsed === null) return null; // unreadable, silently skipped
  return {
    path: relPath,
    body: parsed.body,
    frontmatterRaw: parsed.frontmatterRaw,
    frontmatter: parsed.frontmatter,
    modifiedAtMs: Math.round(s.mtimeMs),
    ...(parsed.parseIssues ? { parseIssues: parsed.parseIssues } : {}),
  };
}

/**
 * TOCTOU-aligned stat for the scoped path: `lstat` re-verifies the entry
 * is a regular file (not a symlink / socket / FIFO swapped in) and supplies
 * the size for the oversized guard, all before the read. Returns the
 * `Stats` for a passing regular file, or `null` when the path vanished, is
 * not a regular file, or exceeds the size limit (reporting it as oversized).
 */
async function statRegularFile(
  full: string,
  relPath: string,
  sizeLimit: IWalkSizeLimit,
): Promise<import('node:fs').Stats | null> {
  let s;
  try {
    s = await lstat(full);
  } catch {
    return null; // vanished between the chokidar event and the read
  }
  if (!s.isFile()) return null;
  if (sizeLimit.maxFileSizeBytes !== undefined && s.size > sizeLimit.maxFileSizeBytes) {
    sizeLimit.onOversizedFile?.({ path: relPath, bytes: s.size });
    return null;
  }
  return s;
}

/**
 * Resolve `full` to the root-relative POSIX path under the first root
 * that contains it, or `null` when it sits under none. Mirrors the
 * `relative(root, full).split(sep).join('/')` form the traversal path
 * emits so scoped and traversed nodes share the same `path` shape.
 */
function relativeFromRoots(full: string, absRoots: readonly string[]): string | null {
  for (const root of absRoots) {
    const rel = relative(root, full);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    return rel.split(sep).join('/');
  }
  return null;
}

/**
 * Read a file and run the configured parser over it. Shared by the
 * walker's eager path and the lazy `reread` on `unchanged` records.
 * Returns `null` (eager path: skip the file) when the read fails; the
 * lazy `reread` callers map `null` onto empty content (the file vanished
 * between the walk and the reread, a rare race).
 */
async function readAndParse(
  full: string,
  relPath: string,
  parser: ReturnType<typeof getParser>,
  bodyField: string | undefined,
): Promise<{
  body: string;
  frontmatterRaw: string;
  frontmatter: Record<string, unknown>;
  parseIssues?: readonly IParseIssue[];
} | null> {
  let raw: string;
  try {
    raw = await readFile(full, 'utf8');
  } catch {
    return null;
  }
  const parsed = parser!.parse(raw, relPath);
  return {
    body: resolveEffectiveBody(parsed.body, parsed.frontmatter, bodyField),
    frontmatterRaw: parsed.frontmatterRaw,
    frontmatter: parsed.frontmatter,
    ...(parsed.issues && parsed.issues.length > 0 ? { parseIssues: parsed.issues } : {}),
  };
}

/**
 * Pick the node body the walker yields. When the Provider declared a
 * `bodyField` (e.g. openai's `instructions`) and that frontmatter key is a
 * string, it IS the markdown body (formats that carry the prompt inside
 * structured frontmatter, like Codex's pure-TOML sub-agents). Otherwise the
 * parser's own `body` (everything after the frontmatter fence) is used,
 * unchanged, the default for every `.md` provider.
 */
function resolveEffectiveBody(
  parsedBody: string,
  frontmatter: Record<string, unknown>,
  bodyField: string | undefined,
): string {
  if (bodyField !== undefined) {
    const candidate = frontmatter[bodyField];
    if (typeof candidate === 'string') return candidate;
  }
  return parsedBody;
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
 * One file surfaced by the recursive walker: its absolute path plus the
 * `mtime` (Unix ms, rounded to a whole millisecond) read from the
 * TOCTOU `lstat`. Bundled so `walkContent` threads the modification time
 * onto the emitted `IRawNode` without a second `stat`.
 */
interface IWalkEntry {
  full: string;
  modifiedAtMs: number;
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
): AsyncIterable<IWalkEntry> {
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
        // `mtimeMs` is a float on some platforms; round to whole millis
        // so the value satisfies the spec's `integer` node field.
        yield { full, modifiedAtMs: Math.round(s.mtimeMs) };
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
