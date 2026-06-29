/**
 * `.skillmapignore` parser + filter facade. Wraps `ignore` (kaelzhang)
 * with the project-local layering: bundled defaults → `config.ignore`
 * (from `.skill-map/settings.json`) → `.skillmapignore` file content.
 *
 * Why a wrapper instead of exposing `ignore` directly:
 *
 * 1. Single-source defaults, `src/config/defaults/skillmapignore` is
 *    the canonical default list, loaded once at module init (or at
 *    explicit build time, depending on bundling). The runtime never
 *    re-reads it per scan.
 * 2. Stable interface, Providers and the orchestrator depend on a
 *    minimal `IIgnoreFilter` shape, so the underlying library can be
 *    swapped without touching every consumer.
 * 3. Path normalization, every consumer passes the path RELATIVE to
 *    the scan root (POSIX separators); the wrapper guarantees that
 *    contract before delegating to `ignore`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ignoreFactory from 'ignore';

export interface IIgnoreFilter {
  /**
   * Returns `true` when `relativePath` should be skipped. The caller
   * MUST pass paths relative to the scan root, with POSIX separators
   * (forward slashes), no leading `/`. Directories MAY be passed with
   * or without trailing `/`; the wrapper does not require it.
   */
  ignores(relativePath: string): boolean;
}

export interface IBuildIgnoreFilterOptions {
  /** Patterns from `config.ignore` in `.skill-map/settings.json`. */
  configIgnore?: string[] | undefined;
  /**
   * Raw text of the project's `.skillmapignore` file. Comments and
   * blank lines are tolerated by `ignore` itself; the caller does not
   * need to pre-process. Accepts `undefined` so callers can forward
   * `readIgnoreFileText()` directly without a guard.
   */
  ignoreFileText?: string | undefined;
  /**
   * Raw text of the project's root `.gitignore`. Folded in as a layer so
   * the scan + watcher skip whatever git already skips. `undefined` when
   * the file is absent. Comments / blank lines tolerated by `ignore`.
   */
  gitignoreText?: string | undefined;
  /**
   * When `false`, the bundled defaults are NOT pre-loaded. Default is
   * `true`. Tests use `false` to assert the precise effect of a single
   * pattern.
   */
  includeDefaults?: boolean | undefined;
}

/**
 * Build a filter from any combination of layers. Layer order is fixed:
 *
 *   1. bundled defaults (`src/config/defaults/skillmapignore`)
 *   2. `configIgnore`
 *   3. `ignoreFileText`
 *
 * Later layers override earlier ones via gitignore negation rules
 * (`!pattern` re-includes a path the prior layer excluded).
 *
 * Full order with `.gitignore` folded in:
 *   defaults → `.gitignore` → `configIgnore` → `.skillmapignore`
 * so a project `.skillmapignore` can `!`-re-include a git-ignored path.
 */
export function buildIgnoreFilter(opts: IBuildIgnoreFilterOptions = {}): IIgnoreFilter {
  const ig = ignoreFactory();
  const addLayer = (layer: string | string[] | undefined): void => {
    if (layer === undefined) return;
    if (layer.length > 0) ig.add(layer);
  };
  if (opts.includeDefaults !== false) ig.add(loadDefaultsText());
  addLayer(opts.gitignoreText);
  addLayer(opts.configIgnore);
  addLayer(opts.ignoreFileText);
  return {
    ignores(relativePath: string): boolean {
      // `ignore` requires a non-empty relative path; the empty string
      // (the root itself) MUST never be ignored.
      if (relativePath === '' || relativePath === '.' || relativePath === './') {
        return false;
      }
      const normalised = relativePath.replace(/^\.\//, '').replace(/\\/g, '/').replace(/^\//, '');
      if (normalised === '') return false;
      return ig.ignores(normalised);
    },
  };
}

/**
 * Read a scope's `.gitignore` + `.skillmapignore` from disk and build the
 * layered filter (defaults → `.gitignore` → `config.ignore` →
 * `.skillmapignore`). The one-shot composer the CLI scan paths share so
 * they don't each re-duplicate the read + layer wiring. The watcher
 * composes from STABLE async reads instead (atomic-save race), see
 * `readGitignoreTextStable` / `readIgnoreFileTextStable`.
 */
export function composeScopeIgnoreFilter(
  scopeRoot: string,
  configIgnore?: readonly string[],
): IIgnoreFilter {
  const opts: IBuildIgnoreFilterOptions = {};
  if (configIgnore && configIgnore.length > 0) opts.configIgnore = [...configIgnore];
  const gitignoreText = readGitignoreText(scopeRoot);
  if (gitignoreText !== undefined) opts.gitignoreText = gitignoreText;
  const ignoreFileText = readIgnoreFileText(scopeRoot);
  if (ignoreFileText !== undefined) opts.ignoreFileText = ignoreFileText;
  return buildIgnoreFilter(opts);
}

/**
 * Return the bundled defaults text. Useful for `sm init` (which writes
 * the file into the user's scope) and for tests. The same caching
 * logic backs `buildIgnoreFilter` so this never re-reads from disk on
 * a hot path.
 */
export function loadBundledIgnoreText(): string {
  return loadDefaultsText();
}

/**
 * Read `.skillmapignore` from `<root>/.skillmapignore` if it exists,
 * else return `undefined`. Caller passes the result as `ignoreFileText`
 * to `buildIgnoreFilter`.
 */
export function readIgnoreFileText(scopeRoot: string): string | undefined {
  return readScopeFileText(scopeRoot, '.skillmapignore');
}

/**
 * Read `<root>/.gitignore` if it exists, else `undefined`. Root file only
 * (not nested git-style), mirroring how `.skillmapignore` is root-only.
 * Caller passes the result as `gitignoreText` to `buildIgnoreFilter`.
 */
export function readGitignoreText(scopeRoot: string): string | undefined {
  return readScopeFileText(scopeRoot, '.gitignore');
}

/** Read `<root>/<filename>` as utf8; `undefined` when absent or unreadable. */
function readScopeFileText(scopeRoot: string, filename: string): string | undefined {
  const path = resolve(scopeRoot, filename);
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Async version of `readIgnoreFileText` that waits until the file's
 * content stops changing before returning. Used by the BFF + CLI
 * `sm watch` meta-file handlers when chokidar fires a `change` event
 * for `.skillmapignore`.
 *
 * Why: editors save in two motions, truncate (or rename-over) and
 * then write. chokidar emits the `change` event on the first motion
 * already, so a naive read can land while the file is empty or
 * partially flushed, rebuilding the ignore filter without the new
 * pattern. The user then has to save again to get the real effect.
 *
 * Strategy: read, sleep ~50 ms, read again. If both reads agree, the
 * file has settled, return that text. If they differ, retry up to
 * `maxAttempts` times. After the cap (~500 ms), use whatever the last
 * read produced; even partial content beats blocking the watcher.
 *
 * Default knobs (`pollMs: 50`, `maxAttempts: 10`) mirror the canonical
 * chokidar `awaitWriteFinish` recipe and were chosen because every
 * common editor (VS Code, vim, JetBrains, nano) settles inside that
 * window.
 */
export async function readIgnoreFileTextStable(
  scopeRoot: string,
  opts: { pollMs?: number; maxAttempts?: number } = {},
): Promise<string | undefined> {
  return readFileTextStable(() => readIgnoreFileText(scopeRoot), opts);
}

/**
 * Stable read of `<root>/.gitignore`, the `.gitignore` counterpart to
 * `readIgnoreFileTextStable` (used by the meta-watcher when `.gitignore`
 * is edited, so the rebuilt filter sees the settled content).
 */
export async function readGitignoreTextStable(
  scopeRoot: string,
  opts: { pollMs?: number; maxAttempts?: number } = {},
): Promise<string | undefined> {
  return readFileTextStable(() => readGitignoreText(scopeRoot), opts);
}

/**
 * Poll `read()` until two consecutive reads agree (or the attempt cap),
 * absorbing the truncate-then-write window of an editor save. Shared by
 * the `.skillmapignore` / `.gitignore` stable readers (knobs default
 * `pollMs: 50`, `maxAttempts: 10`, the canonical chokidar recipe).
 */
async function readFileTextStable(
  read: () => string | undefined,
  opts: { pollMs?: number; maxAttempts?: number },
): Promise<string | undefined> {
  const pollMs = opts.pollMs ?? 50;
  const maxAttempts = opts.maxAttempts ?? 10;
  let prev = read();
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((r) => setTimeout(r, pollMs));
    const curr = read();
    if (curr === prev) return curr;
    prev = curr;
  }
  return prev;
}

// -----------------------------------------------------------------------------
// Bundled defaults loader
// -----------------------------------------------------------------------------

let cachedDefaults: string | null = null;

function loadDefaultsText(): string {
  if (cachedDefaults !== null) return cachedDefaults;
  cachedDefaults = readDefaultsFromDisk();
  return cachedDefaults;
}

/** Test-only, drop the cache so a unit test can simulate a missing file. */
export function _resetDefaultsCacheForTests(): void {
  cachedDefaults = null;
}

/**
 * Resolve `src/config/defaults/skillmapignore` from disk. Walks a small
 * list of candidate locations relative to this module so the lookup
 * works in both the dev layout (`src/kernel/scan/ignore.ts` →
 * `src/config/defaults/`) and the bundled layout (single-file
 * `dist/...js` → `dist/config/defaults/`, populated by tsup `onSuccess`).
 */
function readDefaultsFromDisk(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../config/defaults/skillmapignore'), // src/kernel/scan/ → src/config/defaults/
    resolve(here, '../config/defaults/skillmapignore'), // dist/cli.js → dist/config/defaults/ (siblings)
    resolve(here, 'config/defaults/skillmapignore'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf8');
      } catch {
        /* try next candidate */
      }
    }
  }
  // Fail soft: the scan still works without bundled defaults. The user's
  // own `.skillmapignore` + config.ignore still apply.
  return '';
}
