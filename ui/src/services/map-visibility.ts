import { Injectable, computed, effect, signal } from '@angular/core';

import { readStoredVisiblePaths, writeStoredVisiblePaths } from './map-visibility.storage';

/**
 * Tri-state of a folder's visibility, derived from how many of its
 * descendant leaves are in the inclusion set.
 */
export type TFolderVisibility = 'all' | 'none' | 'some';

/** Value-equality for two path sets (order- and identity-independent). */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Shared, project-local store for the MAP visibility curation set.
 *
 * Holds an INCLUSION whitelist of node paths the user wants on the map.
 * Empty set is the default and means "show everything" (subject to facet
 * filters); a non-empty set means "show ONLY these" (still intersected
 * with the facet filters downstream). The graph view reads this and
 * intersects it into its visible projection; the rail writes it via the
 * per-row checkboxes and the isolate gesture. Deliberately decoupled
 * from edge/topology data: neighborhood computation lives in the graph
 * view, which owns the link graph.
 *
 * Persisted to `localStorage` (survives a reload) via an effect, mirroring
 * the `nodePositions` / `collapsed` discipline. Mutations are immutable
 * `new Set(prev)` swaps so signal consumers re-run on identity change.
 */
@Injectable({ providedIn: 'root' })
export class MapVisibilityService {
  private readonly _paths = signal<ReadonlySet<string>>(readStoredVisiblePaths());

  /** The inclusion set. Empty == "show all on the map". */
  readonly paths = this._paths.asReadonly();

  /** True when curation is active (the map is showing a restricted set). */
  readonly isActive = computed(() => this._paths().size > 0);

  /** Count of curated-in nodes, for badges. */
  readonly count = computed(() => this._paths().size);

  /**
   * Whether a node path is in scope for the map. When curation is inactive
   * (empty set) everything is in scope; once active, only the curated paths
   * are. Reactive (reads the inclusion signal), so consumers that call it
   * inside a `computed` (e.g. the graph palettes scoping their counts to the
   * curated set) re-run when the curation changes.
   */
  inScope(path: string): boolean {
    const paths = this._paths();
    return paths.size === 0 || paths.has(path);
  }

  constructor() {
    effect(() => writeStoredVisiblePaths(this._paths()));
  }

  /** Toggle a single leaf node's membership. */
  toggleLeaf(path: string): void {
    const next = new Set(this._paths());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this._paths.set(next);
  }

  /**
   * Tri-state folder cascade. If every descendant leaf is already in the
   * set ('all'), clicking removes them all; otherwise ('none' / 'some')
   * it adds them all. Matches the standard tree-checkbox contract.
   */
  toggleFolder(leafPaths: Iterable<string>): void {
    const leaves = [...leafPaths];
    if (leaves.length === 0) return;
    const next = new Set(this._paths());
    const fill = this.folderState(leaves) !== 'all';
    for (const path of leaves) {
      if (fill) next.add(path);
      else next.delete(path);
    }
    this._paths.set(next);
  }

  /** Tri-state of a folder, from its descendant leaf paths. */
  folderState(leafPaths: Iterable<string>): TFolderVisibility {
    const current = this._paths();
    let total = 0;
    let included = 0;
    for (const path of leafPaths) {
      total++;
      if (current.has(path)) included++;
    }
    if (total === 0 || included === 0) return 'none';
    return included === total ? 'all' : 'some';
  }

  /** Replace the whole set (the isolate gesture's apply primitive). */
  setOnly(paths: Iterable<string>): void {
    this._paths.set(new Set(paths));
  }

  // --- isolate toggle bookkeeping -----------------------------------------
  // In-memory only (NOT persisted): a reload starts a fresh isolate cycle,
  // which is the sane default. The snapshot holds the inclusion set as it was
  // right before the last isolate; the origin + result let a re-isolate of the
  // SAME node decide whether the map is still showing exactly what that isolate
  // produced (strict toggle) or whether the user edited curation in between.
  private _isolateOrigin: string | null = null;
  private _isolateSnapshot: ReadonlySet<string> | null = null;
  private _isolateResult: ReadonlySet<string> | null = null;

  private resetIsolateMemory(): void {
    this._isolateOrigin = null;
    this._isolateSnapshot = null;
    this._isolateResult = null;
  }

  /**
   * Isolate gesture with toggle-back. The first call snapshots the current
   * inclusion set, then narrows the map to `neighborhood`. A second call for
   * the SAME `origin`, while the map is still showing exactly that
   * neighborhood, restores the snapshot (the visibility from before the
   * isolate). Any other call (a different `origin`, or the curation was edited
   * in between so the live set no longer matches) starts a fresh isolate and
   * re-snapshots. Returns the action taken so the caller can keep node
   * selection in sync (`isolated` selects the origin; `restored` leaves
   * selection untouched).
   *
   * The neighborhood itself is computed by the graph view, which owns the link
   * graph, keeping this service decoupled from topology.
   */
  isolate(origin: string, neighborhood: Iterable<string>): 'isolated' | 'restored' {
    const result = new Set(neighborhood);
    const isToggleBack =
      this._isolateOrigin === origin &&
      this._isolateResult !== null &&
      setsEqual(this._paths(), this._isolateResult);
    if (isToggleBack) {
      const snapshot = this._isolateSnapshot ?? new Set<string>();
      this.resetIsolateMemory();
      this.setOnly(snapshot);
      return 'restored';
    }
    this._isolateSnapshot = this._paths();
    this._isolateOrigin = origin;
    this._isolateResult = result;
    this.setOnly(result);
    return 'isolated';
  }

  /** Clear curation; the map returns to "show all". */
  clear(): void {
    if (this._paths().size === 0) return;
    this._paths.set(new Set());
  }

  /**
   * Drop any path no longer present after a re-scan. If pruning empties
   * the set the map falls back to "show all", the consistent default.
   */
  prune(validPaths: ReadonlySet<string>): void {
    const current = this._paths();
    if (current.size === 0) return;
    let changed = false;
    const next = new Set<string>();
    for (const path of current) {
      if (validPaths.has(path)) next.add(path);
      else changed = true;
    }
    if (changed) this._paths.set(next);
  }
}
