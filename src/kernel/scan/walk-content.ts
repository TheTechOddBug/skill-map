/**
 * Kernel walker. Discovers files inside one or more scope roots,
 * reads each, parses it via the configured parser, and yields
 * `IRawNode` records the orchestrator consumes.
 *
 * Owns the audit-cleared defences (every Provider that uses the walker
 * inherits these — no duplication needed in `Provider.walk`):
 *
 *   - **Symlinks (audit M7)** — `entry.isSymbolicLink()` is checked
 *     explicitly and the entry is skipped. Without this guard we relied
 *     on `Dirent.isFile()` returning false for symlinks, which is an
 *     implementation detail of node's `withFileTypes`. The explicit
 *     skip is both self-documenting and resilient to future Dirent API
 *     changes. The `followSymlinks?: false` option is reserved for a
 *     future implementation that adds cycle detection + `realpath`-
 *     resolved containment; until then the type forbids `true`.
 *   - **TOCTOU race (audit M7)** — `readdir` reports a regular file →
 *     `stat()` re-verifies before the read. Closes the window where the
 *     entry could be swapped for a symlink between the two calls.
 *     `stat` follows symlinks; rejecting non-regular results closes
 *     that lane too.
 *   - **Ignore filter** — every directory and file's path-relative-to-
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

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { IRawNode } from '../extensions/provider.js';
import { buildIgnoreFilter, type IIgnoreFilter } from './ignore.js';
import { getParser } from './parsers/index.js';

export interface IWalkContentOptions {
  /**
   * File extensions the walker yields. Strings include the leading dot
   * (e.g. `'.md'`, `'.mdc'`, `'.toml'`). Match is suffix-based; the
   * extension comparison is case-sensitive — Providers MUST list every
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
   * Reserved escape hatch for a future symlink-follow implementation.
   * Today the walker hard-skips symlinks per audit M7. The type forbids
   * `true` until the audit-cleared follow path is actually built.
   */
  followSymlinks?: false;
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
  for (const root of roots) {
    for await (const file of walkRoot(root, root, filter, extensions)) {
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
      };
    }
  }
}

// eslint-disable-next-line complexity
async function* walkRoot(
  root: string,
  current: string,
  filter: IIgnoreFilter,
  extensions: readonly string[],
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
      yield* walkRoot(root, full, filter, extensions);
    } else if (entry.isFile() && hasMatchingExtension(name, extensions)) {
      // TOCTOU re-check: readdir reported a regular file; verify before
      // reading. `stat` follows symlinks, so a swap between the two
      // calls is rejected here.
      try {
        const s = await stat(full);
        if (s.isFile()) yield full;
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
