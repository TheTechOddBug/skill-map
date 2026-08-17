/**
 * Kernel walker. Discovers files inside one or more scope roots,
 * reads each, parses it via the configured parser, and yields
 * `IRawNode` records the orchestrator consumes.
 *
 * Owns the audit-cleared defences (every Provider that uses the walker
 * inherits these, no duplication needed in `Provider.walk`):
 *
 *   - **Symlinks (audit M7, containment M1)**, followed to directories and
 *     files alike. The explicit `isSymbolicLink()` branch is
 *     self-documenting and resilient to future Dirent API changes.
 *     DECISION (2026-07-05, supersedes the 2026-07-02 "always follow"
 *     stance): a symlink whose real target ESCAPES every scan root is
 *     refused by default (the realpath-containment gate `isPathContained`),
 *     because under the clone-and-scan threat model the link author is the
 *     attacker, not the operator, so a committed `notes.md -> ~/.ssh/id_rsa`
 *     (arbitrary file read into the graph) or `docs/x -> ~/` / `-> /`
 *     (out-of-tree slurp + traversal DoS) must not be followed. A link
 *     whose target stays inside a scan root is always followed. The
 *     `scan.followExternalSymlinks` config key (project-local only,
 *     default off) restores the old dereference-anywhere behaviour for a
 *     tree whose links the operator authored and trusts. Two defences
 *     remain regardless: **cycle detection** (`ctx.chain`, the realpaths
 *     of the directories on the CURRENT recursion branch; a link whose
 *     target is an ancestor of that branch would re-enter itself and is
 *     skipped, so a loop can never hang the walk, while sibling links to
 *     the same target each yield their own subtree because each link path
 *     is its own node; 2026-08-07 fix, the previous walk-global visited
 *     set silently dropped every link after the first one to reach a
 *     target), plus a hard cap (`MAX_SYMLINK_DIR_ENTRIES`) on directories
 *     entered via a symlink so a hostile diamond-shaped link graph cannot
 *     make the walk exponential. The yielded path keeps the form seen
 *     UNDER the link (so node identity matches what the user and the
 *     watcher see), not the resolved target.
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

import { readFile, readdir, lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { IRawNode } from '../extensions/provider.js';
import { isPathContained } from '../util/path-containment.js';
import { mapOrderedPrefetch } from './ordered-prefetch.js';
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
   * `developer_instructions` field). Absent or non-string → the parser's
   * `body` is used unchanged.
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
  /**
   * Mirror of `scan.followExternalSymlinks`. When `false` (the default),
   * a symbolic link whose real target escapes every scan root is refused
   * and skipped, so a cloned hostile repo cannot use a committed symlink
   * to read arbitrary local files into the graph (`notes.md -> ~/.ssh/id_rsa`)
   * or drive a filesystem-traversal DoS (`docs/x -> /`). Links whose
   * target stays inside a scan root are always followed. When `true`, the
   * pre-containment behaviour is restored: escaping links are dereferenced
   * wherever they point (cycle detection still applies). Absent → `false`.
   */
  followExternalSymlinks?: boolean;
  /**
   * Directory-level containment memo for the SCOPED path, shared across
   * the per-provider walks of one pass.
   *
   * The scoped read runs once per active provider over the same changed
   * set, and a containment check needs a `realpath` per path. Resolving
   * every file individually roughly doubles the incremental pass (measured
   * +119% on a 2000-file / 5-provider batch); memoising the DIRECTORY
   * verdict collapses it to +8%, because a batch shares directories and
   * the escape can only enter through a directory component (the leaf is
   * handled separately, and only real symlinks pay for it).
   *
   * Absent → `walkScoped` allocates its own, so a single-shot caller
   * (`submit-engine`) stays correct without ceremony. Valid for ONE pass
   * only: a directory symlink swapped mid-batch keeps its cached verdict
   * for a few milliseconds, the same TOCTOU window the traversal path
   * already carries.
   */
  scopedContainmentCache?: TScopedContainmentCache;
}

/**
 * `dirname` → "resolves inside a scan root" verdict. See
 * `IWalkContentOptions.scopedContainmentCache`.
 */
export type TScopedContainmentCache = Map<string, boolean>;

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
    yield* walkScoped(roots, options.scopedPaths, extensions, sizeLimit, parser, bodyField, {
      rootReals: await resolveRootReals(roots),
      followExternalSymlinks: options.followExternalSymlinks === true,
      cache: options.scopedContainmentCache ?? new Map(),
    });
    return;
  }

  yield* walkTraversal(roots, options, filter, extensions, sizeLimit, parser, bodyField);
}

/**
 * Full directory traversal (the non-scoped path). Walks every root under a
 * shared context (the cycle-detection `visited` set). Split out of
 * `walkContent` to keep that entry point under the complexity cap.
 */
async function* walkTraversal(
  roots: readonly string[],
  options: IWalkContentOptions,
  filter: IIgnoreFilter,
  extensions: readonly string[],
  sizeLimit: IWalkSizeLimit,
  parser: ReturnType<typeof getParser>,
  bodyField: string | undefined,
): AsyncIterable<IRawNode> {
  const ctx: IWalkRootCtx = {
    filter,
    extensions,
    sizeLimit,
    chain: new Set<string>(),
    symlinkDirEntries: 0,
    rootReals: await resolveRootReals(roots),
    followExternalSymlinks: options.followExternalSymlinks === true,
  };
  for (const root of roots) {
    // Seed the ancestor chain with the root's realpath. A root that fails
    // to resolve is skipped: `walkRoot`'s `readdir` would fail the same
    // way, so nothing is lost.
    let rootReal: string;
    try {
      rootReal = await realpath(root);
    } catch {
      continue;
    }
    ctx.chain.add(rootReal);
    // Ordered bounded read-ahead: up to READ_AHEAD_FILES file reads +
    // parses overlap while the traversal keeps pulling entries; yield
    // order stays byte-identical to the serial loop this replaces (the
    // downstream first-wins / truncation / progress-index surfaces are
    // all order-load-bearing). The mtime gate inside
    // `traversedEntryToNode` precedes any read, so unchanged files are
    // still never read. An early consumer break (the orchestrator's
    // scan-ceiling `break`) propagates `return()` through the prefetch
    // into `walkRoot`.
    for await (const rec of mapOrderedPrefetch(
      walkRoot(root, root, rootReal, ctx),
      READ_AHEAD_FILES,
      (entry) => {
        const relPath = relative(root, entry.full).split(sep).join('/');
        return traversedEntryToNode(entry, relPath, options.priorMtimes, parser, bodyField);
      },
    )) {
      if (rec !== null) yield rec;
    }
    ctx.chain.delete(rootReal);
  }
}

/**
 * Read-ahead depth for the traversal walk. Bounded memory: at worst
 * READ_AHEAD_FILES bodies are buffered at once, 16 x the 1 MiB
 * `scan.maxFileSizeBytes` default = 16 MiB. Deliberately hardcoded
 * (not config-surfaced): it is an implementation knob with no
 * user-observable behavior, and a wrong user value could only hurt.
 */
const READ_AHEAD_FILES = 16;

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
  // File mtime from the TOCTOU `lstat` (zero extra syscalls). Threaded
  // onto the persisted `Node` as `modifiedAtMs`.
  return parsedToRawNode(relPath, parsed, entry.modifiedAtMs);
}

/**
 * Compose the eager-path `IRawNode` from one `readAndParse` result.
 * Shared by the traversal and scoped walks so the optional-field
 * spreads (`frontmatterDeclared`, `bodyLineOffset`, and the audit-L1
 * `parseIssues` forwarding that lets the orchestrator surface parser
 * diagnostics as warn-level `Issue` rows) never drift between them.
 */
function parsedToRawNode(
  relPath: string,
  parsed: NonNullable<Awaited<ReturnType<typeof readAndParse>>>,
  modifiedAtMs: number,
): IRawNode {
  return {
    path: relPath,
    body: parsed.body,
    frontmatterRaw: parsed.frontmatterRaw,
    frontmatter: parsed.frontmatter,
    ...(parsed.frontmatterDeclared ? { frontmatterDeclared: true } : {}),
    ...(parsed.bodyLineOffset !== undefined ? { bodyLineOffset: parsed.bodyLineOffset } : {}),
    modifiedAtMs,
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
  gate: IScopedGate,
): AsyncIterable<IRawNode> {
  const absRoots = roots.map((r) => (isAbsolute(r) ? r : resolve(r)));
  for (const scoped of scopedPaths) {
    const rec = await scopedPathToNode(
      scoped, absRoots, extensions, sizeLimit, parser, bodyField, gate,
    );
    if (rec !== null) yield rec;
  }
}

/**
 * Containment inputs for the scoped path, the counterpart of the
 * traversal path's `IWalkRootCtx` fields (audit H4). Lexical containment
 * (`relativeFromRoots`) is not enough: `docs/link/x.md` where `link`
 * escapes the tree is lexically interior yet reads out-of-tree content.
 */
interface IScopedGate {
  /** Scan-root realpaths; `isPathContained` matches against these. */
  rootReals: readonly string[];
  /** Mirror of `scan.followExternalSymlinks`; when true the gate is disabled. */
  followExternalSymlinks: boolean;
  /** Shared per-pass directory verdict memo. */
  cache: TScopedContainmentCache;
}

/**
 * True when reading `full` stays inside a scan root, mirroring the
 * traversal path's `followSymlink` gate (audit M1) for the scoped read.
 *
 * Two escape vectors, resolved at different costs on purpose:
 *
 *   - **The leaf is a symlink** (`notes.md -> ~/.ssh/id_rsa`): its own
 *     `realpath` must be contained. That single call also resolves every
 *     directory component, so no further check is needed. Rare, so it
 *     pays full price and is never cached.
 *   - **A directory component is a symlink** (`docs/x -> ~/`, the case
 *     the string-only check missed entirely): the parent's `realpath`
 *     must be contained. This is the common path, so the verdict is
 *     memoised per directory, which is what keeps the incremental pass
 *     fast (see `scopedContainmentCache`).
 */
async function isScopedPathContained(
  full: string,
  isSymlink: boolean,
  gate: IScopedGate,
): Promise<boolean> {
  if (gate.followExternalSymlinks) return true;
  if (isSymlink) {
    try {
      return isPathContained(await realpath(full), gate.rootReals);
    } catch {
      return false; // broken link
    }
  }
  const dir = dirname(full);
  const cached = gate.cache.get(dir);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    ok = isPathContained(await realpath(dir), gate.rootReals);
  } catch {
    ok = false; // vanished or unresolvable
  }
  gate.cache.set(dir, ok);
  return ok;
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
  gate: IScopedGate,
): Promise<IRawNode | null> {
  const full = isAbsolute(scoped) ? scoped : resolve(scoped);
  const relPath = relativeFromRoots(full, absRoots);
  if (relPath === null) return null; // outside every root (string form)
  if (!hasMatchingExtension(full, extensions)) return null; // not this provider's
  // Lexical containment is not enough (audit H4): resolve the real target
  // before reading, exactly as the traversal path does.
  const s = await gatedStatScopedFile(full, relPath, sizeLimit, gate);
  if (s === null) return null; // outside the roots, vanished, non-regular, or oversized
  const parsed = await readAndParse(full, relPath, parser, bodyField);
  if (parsed === null) return null; // unreadable, silently skipped
  return parsedToRawNode(relPath, parsed, Math.round(s.mtimeMs));
}

/**
 * Containment gate plus stat for one scoped path, in the order that pays
 * the fewest syscalls: a single `lstat` establishes whether the leaf is a
 * symlink (which steers the gate) AND feeds the regular-file check, so
 * the entry is stat'd once rather than twice.
 *
 * Returns `null` when the path escapes the roots, vanished, is not a
 * regular file, or is oversized. Split from `scopedPathToNode` to keep
 * that function under the complexity cap.
 */
async function gatedStatScopedFile(
  full: string,
  relPath: string,
  sizeLimit: IWalkSizeLimit,
  gate: IScopedGate,
): Promise<import('node:fs').Stats | null> {
  let head;
  try {
    head = await lstat(full);
  } catch {
    return null; // vanished between the chokidar event and the read
  }
  if (!(await isScopedPathContained(full, head.isSymbolicLink(), gate))) return null;
  return statScopedFile(full, relPath, head, sizeLimit);
}

/**
 * TOCTOU-aligned stat for the scoped path. `head` is the `lstat` the
 * caller already took (it steers the containment gate), reused here so
 * the syscall is not paid twice; it re-verifies the entry is a regular
 * file rather than a socket / FIFO swapped in, and supplies the size for
 * the oversized guard, all before the read.
 *
 * A leaf symlink is FOLLOWED rather than refused, matching the traversal
 * path: `followSymlink` there resolves the link and yields its target
 * when contained. The gate has already established containment by the
 * time this runs, so the `stat` reads a target known to be inside a scan
 * root. Refusing symlinks here instead would leave the two walks
 * disagreeing about the same tree, and would leave the leaf hole plugged
 * only by accident, which is what made the pre-H4 state fragile.
 *
 * Returns the `Stats` for a passing regular file, or `null` when the path
 * vanished, is not a regular file, or exceeds the size limit (reporting
 * it as oversized).
 */
async function statScopedFile(
  full: string,
  relPath: string,
  head: import('node:fs').Stats,
  sizeLimit: IWalkSizeLimit,
): Promise<import('node:fs').Stats | null> {
  let s = head;
  if (s.isSymbolicLink()) {
    try {
      s = await stat(full); // contained by the gate above; follow it
    } catch {
      return null; // broken link, or vanished mid-batch
    }
  }
  return acceptRegularFile(s, relPath, sizeLimit);
}

/**
 * TOCTOU-aligned stat for the TRAVERSAL path: `lstat` (NOT `stat`)
 * re-verifies that the entry `readdir` reported as a regular file still
 * is one, so a benign `.md` swapped for a symlink in the race window is
 * rejected by `acceptRegularFile` (audit H1: the leaf is then a
 * symlink, so `isFile()` is false). Legitimate symlinks never reach
 * here, traversal routes them through `followSymlink`, which knows from
 * `readdir` that the entry is a link. The scoped path needs the
 * opposite treatment (it has no `readdir` verdict to lean on) and uses
 * `statScopedFile`.
 *
 * Only the syscall lives here so `walkRoot` can PREFETCH it per
 * directory; the accept decision (`acceptRegularFile`, including the
 * `onOversizedFile` callback) deliberately runs at yield position so
 * the oversized-report order stays deterministic.
 */
async function lstatSafe(full: string): Promise<import('node:fs').Stats | null> {
  try {
    return await lstat(full);
  } catch {
    return null; // vanished between readdir and the stat
  }
}

/**
 * Shared tail of both stat helpers: accept a regular file within the size
 * limit, reporting an oversized one through the callback.
 */
function acceptRegularFile(
  s: import('node:fs').Stats,
  relPath: string,
  sizeLimit: IWalkSizeLimit,
): import('node:fs').Stats | null {
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
  frontmatterDeclared?: boolean;
  bodyLineOffset?: number;
  parseIssues?: readonly IParseIssue[];
} | null> {
  let raw: string;
  try {
    raw = await readFile(full, 'utf8');
  } catch {
    return null;
  }
  const parsed = parser!.parse(raw, relPath);
  const body = resolveEffectiveBody(parsed.body, parsed.frontmatter, bodyField);
  // The parser's `bodyLineOffset` describes ITS OWN `body` split. When a
  // `bodyField` swap replaced the body with a frontmatter field's string,
  // no file-absolute line mapping exists, drop the offset so line
  // tracking degrades to body-relative instead of pointing at nothing.
  const offsetApplies = body === parsed.body && typeof parsed.bodyLineOffset === 'number';
  return {
    body,
    frontmatterRaw: parsed.frontmatterRaw,
    frontmatter: parsed.frontmatter,
    ...(parsed.frontmatterDeclared ? { frontmatterDeclared: true } : {}),
    ...(offsetApplies ? { bodyLineOffset: parsed.bodyLineOffset } : {}),
    ...(parsed.issues && parsed.issues.length > 0 ? { parseIssues: parsed.issues } : {}),
  };
}

/**
 * Pick the node body the walker yields. When the Provider declared a
 * `bodyField` (e.g. codex's `developer_instructions`) and that frontmatter key is a
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
/**
 * Upper bound on directories entered via a symlink across one walk. With
 * per-branch cycle detection a hostile diamond-shaped link graph (N levels,
 * two links each to the next level's directory) yields 2^N distinct
 * traversal paths; this cap bounds the total work instead (clone-and-scan
 * threat model). Beyond it further symlinked directories are silently
 * skipped. Generous on purpose: a legitimate tree carries a handful of
 * directory links, not hundreds.
 */
export const MAX_SYMLINK_DIR_ENTRIES = 1000;

/**
 * Context threaded through `walkRoot`'s recursion. Only `chain` /
 * `symlinkDirEntries` mutate during the walk; the rest is invariant.
 */
interface IWalkRootCtx {
  filter: IIgnoreFilter;
  extensions: readonly string[];
  sizeLimit: IWalkSizeLimit;
  /**
   * Realpaths of the directories on the CURRENT recursion branch (the
   * scan root down to the directory being read). Cycle detection: a
   * symlink whose target realpath is already in this chain would re-enter
   * an ancestor of its own branch, so it is refused. Maintained
   * add-before-recurse / delete-after around every directory entered (the
   * walk is sequential, so mutate-and-restore is safe). Unlike the
   * walk-global visited set this replaced (2026-08-07), sibling links to
   * the same target are NOT deduplicated: each link path is its own node.
   */
  chain: Set<string>;
  /**
   * Directories entered via a symlink so far, across the whole walk.
   * Backs the `MAX_SYMLINK_DIR_ENTRIES` cap.
   */
  symlinkDirEntries: number;
  /**
   * Realpaths of the scan roots, resolved once at the start of the walk.
   * Backs the symlink-containment gate: a followed link whose target
   * realpath is not equal to or under one of these is refused unless
   * `followExternalSymlinks` is set. Empty when every root failed to
   * resolve (then containment can never hold, so escaping links are
   * skipped, the safe default).
   */
  rootReals: readonly string[];
  /** Mirror of `scan.followExternalSymlinks`; when true the containment gate is disabled. */
  followExternalSymlinks: boolean;
}

/**
 * Resolve and validate a symbolic-link entry on the follow path. Returns
 * `{ kind: 'dir', real }` when the link points at a directory to recurse
 * into (the caller pushes `real` onto `ctx.chain` around the recursion),
 * `{ kind: 'file', entry }` when it points at a size-OK,
 * extension-matching regular file to yield, or `null` when the link is
 * broken, cycles (its target realpath is an ancestor on `ctx.chain`),
 * exceeds the `MAX_SYMLINK_DIR_ENTRIES` cap, or its target is neither a
 * matching file nor a directory.
 * `stat` (NOT `lstat`) is used deliberately here: the caller followed the
 * link, so the target's real type is what matters. A link whose real
 * target escapes every scan root is refused first (the containment gate,
 * audit M1), unless `ctx.followExternalSymlinks` is set.
 */
async function followSymlink(
  full: string,
  name: string,
  rel: string,
  ctx: IWalkRootCtx,
): Promise<{ kind: 'dir'; real: string } | { kind: 'file'; entry: IWalkEntry } | null> {
  let real: string;
  try {
    real = await realpath(full);
  } catch {
    return null; // broken link
  }
  // Containment gate (audit M1): a link whose real target escapes every
  // scan root is refused unless `scan.followExternalSymlinks` is set.
  // Applied here, before the directory / file split, so it covers BOTH a
  // file link disguised as `.md` (`notes.md -> ~/.ssh/id_rsa`) and a
  // directory link that would recurse an out-of-tree subtree
  // (`docs/x -> ~/`, or `-> /` as a traversal DoS). A link that stays
  // inside a root is always followed.
  if (!ctx.followExternalSymlinks && !isPathContained(real, ctx.rootReals)) {
    return null;
  }
  let s;
  try {
    s = await stat(full); // follows the link to its target
  } catch {
    return null;
  }
  if (s.isDirectory()) {
    // Cycle: the target is an ancestor of the CURRENT branch, entering it
    // would recurse forever. A link to any other target is fine even when
    // another branch already walked it: sibling links to one target each
    // yield their own subtree (each link path is its own node).
    if (ctx.chain.has(real)) return null;
    // Pathological-tree defence: per-branch cycle detection alone lets a
    // diamond-shaped link graph multiply traversal paths exponentially.
    if (ctx.symlinkDirEntries >= MAX_SYMLINK_DIR_ENTRIES) return null;
    ctx.symlinkDirEntries += 1;
    return { kind: 'dir', real };
  }
  return symlinkFileEntry(full, name, rel, s, ctx);
}

/**
 * Build the yieldable entry for a followed symlink whose target is a
 * regular file, or `null` when the extension does not match or the file
 * exceeds the size limit. Split from `followSymlink` to keep it under the
 * complexity cap.
 */
function symlinkFileEntry(
  full: string,
  name: string,
  rel: string,
  s: import('node:fs').Stats,
  ctx: IWalkRootCtx,
): { kind: 'file'; entry: IWalkEntry } | null {
  if (!(s.isFile() && hasMatchingExtension(name, ctx.extensions))) return null;
  if (ctx.sizeLimit.maxFileSizeBytes !== undefined && s.size > ctx.sizeLimit.maxFileSizeBytes) {
    ctx.sizeLimit.onOversizedFile?.({ path: rel, bytes: s.size });
    return null;
  }
  return { kind: 'file', entry: { full, modifiedAtMs: Math.round(s.mtimeMs) } };
}

// eslint-disable-next-line complexity
async function* walkRoot(
  root: string,
  current: string,
  realCurrent: string,
  ctx: IWalkRootCtx,
): AsyncIterable<IWalkEntry> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  // Per-directory stat prefetch: kick off the `lstat` for every matching
  // regular-file entry concurrently, then consume the results at each
  // entry's ORIGINAL position below. Directory recursion and symlink
  // resolution stay strictly serial (they mutate the shared ctx.chain).
  const statAhead = prefetchDirStats(entries, root, current, ctx);
  for (const entry of entries) {
    const name = entry.name;
    const full = join(current, name);
    const rel = relative(root, full).split(sep).join('/');
    if (ctx.filter.ignores(rel)) continue;
    if (entry.isSymbolicLink()) {
      const followed = await followSymlink(full, name, rel, ctx);
      if (followed === null) continue; // broken, escaping, cyclic, capped, or non-matching
      if (followed.kind === 'dir') {
        ctx.chain.add(followed.real);
        yield* walkRoot(root, full, followed.real, ctx);
        ctx.chain.delete(followed.real);
      } else {
        yield followed.entry;
      }
      continue;
    }
    if (entry.isDirectory()) {
      // Not a link, so its realpath is the parent's plus the name (zero
      // syscalls). The ancestor-re-entry guard fires only when a linked
      // ancestor made this real directory an ancestor of itself; entering
      // would loop, so it is skipped like the symlink case.
      const realChild = join(realCurrent, name);
      if (ctx.chain.has(realChild)) continue;
      ctx.chain.add(realChild);
      yield* walkRoot(root, full, realChild, ctx);
      ctx.chain.delete(realChild);
    } else if (entry.isFile() && hasMatchingExtension(name, ctx.extensions)) {
      // TOCTOU re-check (audit H1): the (possibly prefetched) `lstat`
      // re-verifies the `readdir` verdict before the read; the accept
      // decision (`isFile()` + `maxFileSizeBytes` + oversized callback)
      // runs HERE, at yield position, so report order is deterministic.
      const stats = await (statAhead.get(full) ?? lstatSafe(full));
      const s = stats === null ? null : acceptRegularFile(stats, rel, ctx.sizeLimit);
      if (s !== null) yield { full, modifiedAtMs: Math.round(s.mtimeMs) };
    }
  }
}

/**
 * Start the `lstat` for every entry the file branch of `walkRoot` will
 * consume, keyed by absolute path. Mirrors that branch's own filters
 * (regular file, matching extension, not ignored) so no extra syscalls
 * fire for entries the loop would skip. `lstatSafe` never rejects, so
 * the parked promises cannot surface unhandled rejections.
 */
function prefetchDirStats(
  entries: readonly import('node:fs').Dirent[],
  root: string,
  current: string,
  ctx: IWalkRootCtx,
): Map<string, Promise<import('node:fs').Stats | null>> {
  const ahead = new Map<string, Promise<import('node:fs').Stats | null>>();
  for (const entry of entries) {
    if (!entry.isFile() || !hasMatchingExtension(entry.name, ctx.extensions)) continue;
    const full = join(current, entry.name);
    const rel = relative(root, full).split(sep).join('/');
    if (ctx.filter.ignores(rel)) continue;
    ahead.set(full, lstatSafe(full));
  }
  return ahead;
}

function hasMatchingExtension(name: string, extensions: readonly string[]): boolean {
  for (const ext of extensions) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Resolve each scan root to its realpath once, for the symlink-containment
 * gate. A root that fails to resolve (does not exist, unreadable) is
 * dropped rather than approximated, so containment can only ever hold
 * against a real, existing anchor, escaping links stay refused when a root
 * is bogus. Returns absolute realpaths with no trailing separator (the
 * form `realpath` yields), which `isPathContained` matches against.
 */
async function resolveRootReals(roots: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    try {
      out.push(await realpath(root));
    } catch {
      // Unresolvable root: skip it. `walkRoot`'s `readdir` will fail the
      // same way, so nothing is lost, and a symlink can't be "contained"
      // by a root that isn't really there.
    }
  }
  return out;
}
