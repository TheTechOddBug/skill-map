/**
 * File watcher for `sm watch` / `sm scan --watch`.
 *
 * Two backends behind one small `IFsWatcher` interface:
 *
 *   - `createParcelWatcher` (`@parcel/watcher`) is the PRIMARY scan
 *     watcher. A single native inotify instance scales to huge trees
 *     without the `EMFILE` exhaustion chokidar hits via per-directory
 *     `fs.watch`.
 *   - `createChokidarWatcher` (`chokidar`) backs the META-watcher (config
 *     files at `depth: 0`), which parcel cannot express (no depth limit).
 *
 * The interface buys two things:
 *
 *   1. The CLI / BFF are impl-agnostic, the backend swap (and a future
 *      selectable backend) doesn't ripple into them.
 *   2. Debouncing, batching, and ignore-filter integration live in one
 *      place (`createDebouncedBatcher` + `normalizeIgnoreFilter`), shared
 *      by both wrappers. The caller just gets `onBatch(paths)` callbacks
 *      and decides whether to re-scan.
 *
 * The watcher does NOT call into the orchestrator itself. That decision
 * is deliberate: the CLI owns the scan-and-persist pipeline (`runScan`,
 * `persistScanResult`, optional rebuild of the ignore filter when
 * `.skillmapignore` itself changes). Pulling that into the watcher
 * would couple the kernel module to `SqliteStorageAdapter`, which the
 * Server wouldn't want. Keep this module side-effect free
 * apart from filesystem subscription.
 *
 * Ignore filter integration: the supplied `IIgnoreFilter` is consulted
 * via chokidar's `ignored` predicate, which receives an absolute path.
 * We re-derive the path RELATIVE to the closest matching root before
 * passing it through `IIgnoreFilter.ignores`. This mirrors what the
 * scan walker does (`extensions/providers/claude/index.ts`) so both code
 * paths agree on what "ignored" means.
 */

import type { Stats } from 'node:fs';
import { realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Both watcher backends are loaded LAZILY inside their factories
// (2026-08 perf sprint): chokidar drags its readdirp tree and
// @parcel/watcher performs a native `dlopen` at import time, costs every
// non-watch verb used to pay on boot. Type-only imports are free.
import type { FSWatcher } from 'chokidar';
import type { AsyncSubscription } from '@parcel/watcher';

import type { IIgnoreFilter } from './ignore.js';
import { readGitignoreText, readIgnoreFileText } from './ignore.js';
import { isPathContained } from '../util/path-containment.js';
import { SKILL_MAP_DIR } from '../util/skill-map-paths.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type TWatchEventKind = 'add' | 'change' | 'unlink';

export interface IWatchEvent {
  kind: TWatchEventKind;
  /** Absolute path. */
  absolutePath: string;
}

export interface IWatchBatch {
  /** Events that arrived inside the debounce window, in arrival order. */
  events: IWatchEvent[];
  /** Convenience: deduplicated absolute paths across the batch. */
  paths: string[];
}

export interface IFsWatcher {
  /** Resolves once chokidar has finished its initial directory scan and is ready to emit. */
  ready: Promise<void>;
  /** Tear down the watcher. Resolves after chokidar releases handles. */
  close: () => Promise<void>;
}

export interface ICreateFsWatcherOptions {
  /** Roots to watch. Resolved relative to `cwd` if relative paths are passed. */
  roots: string[];
  /** Working directory used to resolve relative roots and the ignore-filter root. */
  cwd: string;
  /** Debounce window in milliseconds. `0` triggers `onBatch` synchronously per event. */
  debounceMs: number;
  /**
   * Optional ignore filter, same instance the scan walker uses.
   *
   * Two shapes are accepted:
   *
   *   - **`IIgnoreFilter`** (the static one), captured by reference at
   *     construction. Use this when the filter never changes for the
   *     lifetime of the watcher (the typical CLI `sm watch` flow).
   *
   *   - **`() => IIgnoreFilter | undefined`** (a getter), re-evaluated
   *     on EVERY chokidar `ignored` predicate call. Use this when the
   *     filter can change at runtime, e.g. the BFF rebuilds it after
   *     a `.skillmapignore` or `.skill-map/settings.json` edit and
   *     wants chokidar to immediately respect the new patterns without
   *     tearing down and rebuilding the watcher. A getter that returns
   *     `undefined` disables ignore filtering for that call.
   */
  ignoreFilter?: IIgnoreFilter | (() => IIgnoreFilter | undefined) | undefined;
  /**
   * Maximum directory traversal depth. `undefined` (default) walks the
   * tree recursively without bound; `0` limits the watch to the
   * literal `roots` entries (no descent), which is the right setting
   * when watching a directory only to catch changes to specific
   * top-level files (see `subscribeMeta` in `core/watcher/runtime.ts`).
   * Forwarded verbatim to chokidar's `depth` option.
   */
  depth?: number;
  /**
   * Extension gate. When set, chokidar holds a watch on (and fires events
   * for) only FILES whose name ends with one of these suffixes (e.g.
   * `['.md', '.toml', '.sm']`). Directories always pass so the tree is
   * still traversed to reach matching files. Omitted ⇒ no gate (every
   * non-ignored file is watched, the legacy behaviour). Applied BEFORE
   * the ignore filter. The suffixes mirror the scan walker's provider
   * `read.extensions` (plus the `.sm` sidecar) so the watcher reacts only
   * to the file types a scan would actually open. NOT passed to the
   * meta-watcher, which targets specific config files by path instead.
   */
  watchedExtensions?: readonly string[] | undefined;
  /**
   * Whether the project root `.gitignore` lines feed the PARCEL backend's
   * coarse native prune (`buildParcelIgnore`). Default `false`, mirroring
   * `scan.respectGitignore`: when off, parcel keeps watching git-ignored
   * dirs so nothing the operator asked to index is silently pruned at the
   * OS level. Chokidar ignores this option entirely, its authoritative
   * filter is the live `ignoreFilter` getter. Only meaningful on parcel.
   */
  respectGitignore?: boolean | undefined;
  /**
   * Mirrors `scan.followExternalSymlinks` (default `false`). When off,
   * the CHOKIDAR backend refuses to arm a watch on any path whose
   * realpath escapes every root, the same realpath-containment gate
   * the walker applies (audit M1, and this backend's own finding on
   * 2026-08-01).
   *
   * chokidar dereferences symlinks by default, so before this existed
   * a committed `docs/x -> ~/` made `sm watch --watch-backend chokidar`
   * arm inotify watches across the operator's entire home directory:
   * no content leaked (the walker's read-side gate still refused it)
   * but the watch itself escaped containment, which exhausts inotify
   * and turns out-of-tree edits into an activity oracle.
   *
   * Expressed as a containment gate rather than chokidar's own
   * `followSymlinks: false` on purpose. The blunt flag would also stop
   * following symlinks whose target stays INSIDE the tree, and live
   * updates behind an internal symlinked directory are the entire
   * reason this backend is selectable over parcel. Parcel does not
   * follow symlinks at all, so it needs no gate.
   */
  followExternalSymlinks?: boolean | undefined;
  /** Called once per debounced batch. Awaited; concurrent batches are serialised. */
  onBatch: (batch: IWatchBatch) => void | Promise<void>;
  /**
   * Called when the underlying watcher surfaces an error. The watcher
   * stays open, callers decide whether to log, keep going, or close.
   */
  onError?: (err: Error) => void;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Build the chokidar `ignored` predicate, combining the optional extension
 * gate (only FILES ending in `watchedExts` are watched; directories pass
 * so the tree is still traversed) with the optional ignore filter. Returns
 * `undefined` when neither is configured (watch everything). The two-arg
 * `(path, stats)` shape and the `stats?.isFile()` gate follow the chokidar
 * v5 recipe `ignored: (p, stats) => stats?.isFile() && !p.endsWith(ext)`.
 * Extracted to keep `createChokidarWatcher` under the complexity cap.
 */
function buildIgnoredPredicate(
  getFilter: (() => IIgnoreFilter | undefined) | undefined,
  watchedExts: readonly string[],
  absRoots: string[],
  escapesRoots: ((path: string) => boolean) | undefined,
): ((path: string, stats?: Stats) => boolean) | undefined {
  if (!getFilter && watchedExts.length === 0 && !escapesRoots) return undefined;
  // Containment first: a path resolving out of the tree is refused
  // whatever the extension gate or the ignore filter say.
  return (path: string, stats?: Stats): boolean =>
    escapesRoots?.(path) === true
    || failsExtensionGate(path, stats, watchedExts)
    || matchesIgnoreFilter(path, getFilter, absRoots);
}

/**
 * True when the extension gate is configured and this path is a FILE
 * that does not carry one of the watched suffixes. Directories always
 * pass so the tree is still traversed to reach matching files.
 */
function failsExtensionGate(
  path: string,
  stats: Stats | undefined,
  watchedExts: readonly string[],
): boolean {
  if (watchedExts.length === 0) return false;
  if (stats?.isFile() !== true) return false;
  return !watchedExts.some((ext) => path.endsWith(ext));
}

/** True when the live ignore filter claims this path. */
function matchesIgnoreFilter(
  path: string,
  getFilter: (() => IIgnoreFilter | undefined) | undefined,
  absRoots: string[],
): boolean {
  const filter = getFilter?.();
  if (!filter) return false;
  const rel = relativePathFromRoots(path, absRoots);
  if (rel === null) return false;
  return filter.ignores(rel);
}

/**
 * The chokidar-side twin of the walker's `isScopedPathContained`
 * (`scan/walk-content.ts`): true when `path` resolves OUTSIDE every
 * root, i.e. when arming a watch on it would escape the scan scope.
 * Returns `undefined` (no gate at all) when the operator opted into
 * following escaping symlinks.
 *
 * Sync because chokidar's `ignored` predicate is sync, and memoised per
 * PATH because chokidar re-asks about the same entries on every event.
 * Roots are resolved once up front so a project reached THROUGH a
 * symlink (`/tmp/x -> /home/u/proj`) does not read as if every one of
 * its own files escaped.
 *
 * The verdict comes from the realpath of the path ITSELF, never its
 * parent's. Resolving the path resolves the whole chain, so an
 * escaping component anywhere in it (`docs/link/x.md` where `link`
 * leaves the tree) is already caught, and judging by the parent would
 * be actively wrong at the top: the parent of a scan root is by
 * definition outside every root, so a parent-first gate ignores the
 * root directory and the watcher goes deaf.
 *
 * An unresolvable path (broken link, deleted between the event and
 * this call) counts as escaping: there is nothing there to watch, and
 * failing closed is the posture the rest of the gate takes.
 */
function buildEscapeGate(
  absRoots: string[],
  followExternalSymlinks: boolean,
): ((path: string) => boolean) | undefined {
  if (followExternalSymlinks) return undefined;
  const rootReals: string[] = [];
  for (const root of absRoots) {
    try {
      rootReals.push(realpathSync(root));
    } catch {
      rootReals.push(root); // not yet created; lexical value still anchors it
    }
  }
  const cache = new Map<string, boolean>();
  return (path: string): boolean => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    let escapes: boolean;
    try {
      escapes = !isPathContained(realpathSync(path), rootReals);
    } catch {
      escapes = true;
    }
    cache.set(path, escapes);
    return escapes;
  };
}

/**
 * Normalise the `ignoreFilter` union into a getter (or `undefined`). The
 * static-filter shape becomes a constant getter; resolving it on every
 * call is what lets the BFF swap filters at runtime without tearing the
 * watcher down. Shared by both backend wrappers.
 */
function normalizeIgnoreFilter(
  ignoreFilterOpt: ICreateFsWatcherOptions['ignoreFilter'],
): (() => IIgnoreFilter | undefined) | undefined {
  if (ignoreFilterOpt === undefined) return undefined;
  if (typeof ignoreFilterOpt === 'function') return ignoreFilterOpt;
  return (): IIgnoreFilter => ignoreFilterOpt;
}

/**
 * Debounce + batch machinery shared by every backend wrapper. Collects
 * events, coalesces a burst inside `debounceMs` into one batch (deduping
 * paths), serialises overlapping batches (a slow `onBatch` queues the
 * next), and drains cleanly on close. Backend-agnostic: the chokidar and
 * parcel wrappers differ only in how they feed `enqueue`.
 */
interface IDebouncedBatcher {
  enqueue: (kind: TWatchEventKind, absolutePath: string) => void;
  /** Stop accepting events and drain the in-flight batch (if any). */
  drain: () => Promise<void>;
}

function createDebouncedBatcher(opts: {
  debounceMs: number;
  onBatch: (batch: IWatchBatch) => void | Promise<void>;
  onError?: (err: Error) => void;
}): IDebouncedBatcher {
  let pending: IWatchEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  let closed = false;

  const fire = async (): Promise<void> => {
    timer = null;
    if (pending.length === 0) return;
    // A previous batch is still running; current events stay queued and
    // fire on the next tick once `inFlight` resolves.
    if (inFlight) return;
    const events = pending;
    pending = [];
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const ev of events) {
      if (!seen.has(ev.absolutePath)) {
        seen.add(ev.absolutePath);
        paths.push(ev.absolutePath);
      }
    }
    inFlight = Promise.resolve(opts.onBatch({ events, paths }))
      .catch((err: unknown) => {
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        inFlight = null;
        // Re-schedule if events accumulated while we were busy; respect
        // the debounce window so a slow `onBatch` doesn't re-trigger hot.
        if (!closed && pending.length > 0 && timer === null) schedule();
      });
  };

  const schedule = (): void => {
    if (closed) return;
    if (opts.debounceMs <= 0) {
      void fire();
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void fire(), opts.debounceMs);
  };

  const enqueue = (kind: TWatchEventKind, absolutePath: string): void => {
    if (closed) return;
    pending.push({ kind, absolutePath });
    schedule();
  };

  const drain = async (): Promise<void> => {
    closed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = [];
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // already routed through onError above
      }
    }
  };

  return { enqueue, drain };
}

/**
 * Construct a chokidar-backed watcher. Subscribes immediately; the
 * returned `ready` promise resolves once chokidar's initial directory
 * walk completes, at which point only NEW events fire `onBatch`.
 *
 * The initial directory walk is deliberately silent, we set
 * `ignoreInitial: true`. The CLI runs a one-shot scan before flipping
 * the watcher on, so re-emitting an `add` for every existing file
 * would be redundant churn.
 *
 * Used for the meta-watcher (config files at `depth: 0`); the primary
 * scan watcher uses `createParcelWatcher` to avoid chokidar's `EMFILE`
 * exhaustion on huge trees.
 */
export function createChokidarWatcher(opts: ICreateFsWatcherOptions): IFsWatcher {
  const absRoots = opts.roots.map((r) => resolve(opts.cwd, r));
  const getFilter = normalizeIgnoreFilter(opts.ignoreFilter);
  // Combine the realpath-containment gate + extension gate + ignore
  // filter into chokidar's `ignored` predicate (see
  // `buildIgnoredPredicate` / `buildEscapeGate`).
  const escapesRoots = buildEscapeGate(absRoots, opts.followExternalSymlinks === true);
  const ignored = buildIgnoredPredicate(
    getFilter,
    opts.watchedExtensions ?? [],
    absRoots,
    escapesRoots,
  );

  const batcher = createDebouncedBatcher({
    debounceMs: opts.debounceMs,
    onBatch: opts.onBatch,
    ...(opts.onError ? { onError: opts.onError } : {}),
  });

  // Lazy backend load: the factory stays synchronous (the batcher and
  // the returned facade exist immediately); chokidar itself loads on
  // first use. Behavior delta vs the eager import: a broken chokidar
  // install now surfaces when a watch STARTS (through `ready`) instead
  // of crashing every verb at module load, a strict improvement.
  const watcherPromise: Promise<FSWatcher> = import('chokidar').then(({ default: chokidar }) => {
    const watcher = chokidar.watch(absRoots, {
      ignoreInitial: true,
      persistent: true,
      ...(ignored ? { ignored } : {}),
      ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    });
    watcher.on('add', (p) => batcher.enqueue('add', p));
    watcher.on('change', (p) => batcher.enqueue('change', p));
    watcher.on('unlink', (p) => batcher.enqueue('unlink', p));
    if (opts.onError) {
      watcher.on('error', (err) => {
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }
    return watcher;
  });

  const ready: Promise<void> = watcherPromise.then(
    (watcher) =>
      new Promise((resolveReady) => {
        watcher.once('ready', () => resolveReady());
      }),
  );

  const close = async (): Promise<void> => {
    await batcher.drain();
    const watcher = await watcherPromise.catch(() => null);
    if (watcher) await watcher.close();
  };

  return { ready, close };
}

/**
 * Construct a `@parcel/watcher`-backed watcher (the primary scan watcher).
 * Parcel uses a single native inotify instance (managed in C++) rather
 * than one `fs.watch` per directory, so it does not exhaust inotify
 * instances / file descriptors on huge trees the way chokidar does (the
 * `EMFILE` failure), and arms the tree far faster. Same `IFsWatcher`
 * contract as the chokidar wrapper.
 *
 * Differences from chokidar, all handled here:
 *   - parcel `subscribe` takes ONE directory, so we subscribe per root.
 *   - `ready` resolves once every subscription is armed; parcel only
 *     reports post-subscription changes (no initial events), matching
 *     chokidar's `ignoreInitial: true`.
 *   - parcel's `ignore` is a STATIC glob/path list, so the extension gate
 *     and the (live) ignore filter run per-event in JS via `accept`,
 *     preserving runtime filter swaps. The static `ignore` we pass is a
 *     coarse prune (bundled-default dirs + raw `.gitignore` /
 *     `.skillmapignore` lines) so parcel never even watches `node_modules`
 *     and friends, which is the actual scale win.
 *   - `depth` is not supported by parcel and is ignored (only the
 *     meta-watcher uses `depth: 0`, and that stays on chokidar).
 *
 * NOTE: parcel's symlink support is weak/undocumented, so live updates
 * behind a symlinked directory may not fire on this backend; a full scan
 * still indexes them (the walker follows a symlink whose real target
 * stays inside a scan root, and refuses one that escapes unless
 * `scan.followExternalSymlinks` is set). Selecting chokidar via
 * `--watch-backend chokidar` restores live symlink watching under the
 * same containment rule.
 */
export function createParcelWatcher(opts: ICreateFsWatcherOptions): IFsWatcher {
  const absRoots = opts.roots.map((r) => resolve(opts.cwd, r));
  const getFilter = normalizeIgnoreFilter(opts.ignoreFilter);
  const watchedExts = opts.watchedExtensions ?? [];
  const hasExtGate = watchedExts.length > 0;
  const parcelIgnore = buildParcelIgnore(opts.cwd, opts.respectGitignore === true);

  const batcher = createDebouncedBatcher({
    debounceMs: opts.debounceMs,
    onBatch: opts.onBatch,
    ...(opts.onError ? { onError: opts.onError } : {}),
  });

  // Per-event authoritative filter (parcel's `ignore` is static and only
  // a coarse prune). Drops non-matching extensions and ignored paths,
  // re-reading the filter getter each time so a runtime swap is honoured.
  const accept = (absolutePath: string): boolean => {
    if (hasExtGate && !watchedExts.some((ext) => absolutePath.endsWith(ext))) return false;
    const filter = getFilter?.();
    if (!filter) return true;
    const rel = relativePathFromRoots(absolutePath, absRoots);
    if (rel === null) return true;
    return !filter.ignores(rel);
  };

  // Lazy backend load (see the chokidar twin above): the native dlopen
  // now happens when a watch starts, not on every CLI boot. `ready` /
  // `close` already treat subscriptions as promises, so the extra
  // module-load hop composes for free.
  const parcelModule = import('@parcel/watcher');
  const subscriptions: Promise<AsyncSubscription>[] = absRoots.map((root) =>
    parcelModule.then(({ default: parcelWatcher }) =>
      parcelWatcher.subscribe(
        root,
        (err, events) => {
          if (err) {
            opts.onError?.(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          for (const ev of events) {
            if (!accept(ev.path)) continue;
            const kind: TWatchEventKind =
              ev.type === 'create' ? 'add' : ev.type === 'delete' ? 'unlink' : 'change';
            batcher.enqueue(kind, ev.path);
          }
        },
        { ignore: parcelIgnore },
      ),
    ),
  );

  const ready: Promise<void> = Promise.all(subscriptions).then(() => undefined);

  const close = async (): Promise<void> => {
    await batcher.drain();
    const settled = await Promise.allSettled(subscriptions);
    await Promise.allSettled(
      settled.map((s) => (s.status === 'fulfilled' ? s.value.unsubscribe() : Promise.resolve())),
    );
  };

  return { ready, close };
}

/** Bundled-default directories worth pruning natively from the parcel watch. */
const PARCEL_DEFAULT_IGNORE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  '.tmp',
  SKILL_MAP_DIR,
];

/**
 * Build the coarse static `ignore` list for `parcel.subscribe`: the
 * bundled-default directories (depth-agnostic globs) plus the raw,
 * non-negated lines of the project `.skillmapignore` (and `.gitignore`
 * only when `respectGitignore` is on). This is a best-effort native
 * prune for performance (parcel's glob match is not gitignore-exact);
 * the authoritative correctness gate is the per-event `accept` filter,
 * which uses the real `IIgnoreFilter`. Negated (`!`) and comment lines
 * are dropped here; `accept` honours them.
 *
 * `respectGitignore` defaults `false` (mirrors `scan.respectGitignore`):
 * with it off, the `.gitignore` lines are excluded so parcel keeps
 * watching git-ignored dirs, matching the flag-off scan behaviour.
 */
export function buildParcelIgnore(cwd: string, respectGitignore = false): string[] {
  const out = new Set<string>();
  for (const dir of PARCEL_DEFAULT_IGNORE_DIRS) {
    out.add(dir);
    out.add(`**/${dir}`);
  }
  if (respectGitignore) addParcelIgnoreLines(out, readGitignoreText(cwd));
  addParcelIgnoreLines(out, readIgnoreFileText(cwd));
  return [...out];
}

/**
 * Fold the non-negated, non-comment lines of an ignore-file's raw text
 * into the parcel prune set (trailing slashes trimmed so a `dir/` entry
 * matches parcel's path form). No-op when the file is absent. Split out
 * of `buildParcelIgnore` to keep its branch count under the lint cap.
 */
function addParcelIgnoreLines(out: Set<string>, text: string | undefined): void {
  if (text === undefined) return;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    out.add(line.replace(/\/+$/, ''));
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Pick the matching root for `absolute` and return the path RELATIVE to
 * it, in POSIX form. Returns `null` when the path is outside every
 * supplied root (chokidar shouldn't emit those, but the contract on
 * `IIgnoreFilter.ignores` requires a relative path so we guard
 * defensively).
 */
function relativePathFromRoots(absolute: string, absRoots: string[]): string | null {
  for (const root of absRoots) {
    const rel = relative(root, absolute);
    if (rel === '' || rel === '.') return '';
    if (!rel.startsWith('..') && !rel.startsWith(`..${sep}`)) {
      return rel.split(sep).join('/');
    }
  }
  return null;
}
