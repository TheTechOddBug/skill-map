import { Injectable, computed, effect, signal } from '@angular/core';

import { readStoredVisiblePaths, writeStoredVisiblePaths } from './map-visibility.storage';

/**
 * Tri-state of a folder's selection: `all` when the folder's own prefix
 * is selected, `some` when a strict descendant is selected but the folder
 * is not, `none` otherwise. Computed by the files-view over the tree
 * walk; not derived here.
 */
export type TFolderVisibility = 'all' | 'none' | 'some';

/** Value-equality for two path sets (order- and identity-independent). */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** True when at least one path in `validPaths` is a descendant of `prefix`. */
function hasDescendant(validPaths: ReadonlySet<string>, prefix: string): boolean {
  const needle = `${prefix}/`;
  for (const p of validPaths) if (p.startsWith(needle)) return true;
  return false;
}

/**
 * Shared, project-local store for the MAP selection.
 *
 * Holds the set of PREFIXES (folder paths) and exact LEAF paths the user
 * selected via the rail checkboxes. This selection IS the map control:
 * the loader debounce-fetches `/api/branch` with these paths as repeated
 * `?path=` params and the server returns their capped UNION, which the
 * graph renders directly. An empty set is the default and means "whole
 * corpus root" (the server returns everything up to the cap).
 *
 * Because a folder prefix is sent verbatim (not its expanded leaf set),
 * the request stays small no matter how big the subtree is, and the
 * server applies the cap. The isolate gesture re-selects exact node
 * paths (`setOnly`), which re-fetches that neighborhood; coherent with
 * the rest of the selection. Neighborhood computation lives in the graph
 * view, which owns the link graph, keeping this service decoupled from
 * topology.
 *
 * Persisted to `localStorage` (survives a reload) via an effect, mirroring
 * the `nodePositions` / `collapsed` discipline. Mutations are immutable
 * `new Set(prev)` swaps so signal consumers re-run on identity change.
 */
@Injectable({ providedIn: 'root' })
export class MapVisibilityService {
  private readonly _paths = signal<ReadonlySet<string>>(readStoredVisiblePaths());

  /** The selection set (prefixes + leaf paths). Empty == "whole corpus". */
  readonly paths = this._paths.asReadonly();

  /** True when a selection is active (the map is showing a sub-selection). */
  readonly isActive = computed(() => this._paths().size > 0);

  /** Count of selected prefixes / leaves, for badges. */
  readonly count = computed(() => this._paths().size);

  /**
   * Whether a path is part of the selection. When the selection is empty
   * everything is in scope; once active, only the selected paths are.
   * Reactive (reads the selection signal), so consumers that call it
   * inside a `computed` re-run when the selection changes.
   */
  inScope(path: string): boolean {
    const paths = this._paths();
    return paths.size === 0 || paths.has(path);
  }

  constructor() {
    effect(() => writeStoredVisiblePaths(this._paths()));
  }

  /** Toggle a single leaf node's membership in the selection. */
  toggleLeaf(path: string): void {
    const next = new Set(this._paths());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this._paths.set(next);
  }

  /**
   * Toggle a single folder PREFIX in the selection. The prefix is sent
   * verbatim to `/api/branch`; the server expands it to the (capped)
   * subtree union. Adds the prefix when absent, removes it when present.
   */
  toggleFolder(folderPath: string): void {
    if (folderPath === '') return;
    const next = new Set(this._paths());
    if (next.has(folderPath)) next.delete(folderPath);
    else next.add(folderPath);
    this._paths.set(next);
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
   * Drop any selected path no longer present after a re-scan. The
   * selection holds folder PREFIXES + exact leaf paths, so a path stays
   * valid when it is itself a node OR it is a folder prefix that still
   * has at least one descendant node. Without the prefix check a folder
   * selection (never itself a node path) would be wiped on every prune.
   * If pruning empties the set the map falls back to "show all".
   */
  prune(validPaths: ReadonlySet<string>): void {
    const current = this._paths();
    if (current.size === 0) return;
    let changed = false;
    const next = new Set<string>();
    for (const path of current) {
      if (validPaths.has(path) || hasDescendant(validPaths, path)) next.add(path);
      else changed = true;
    }
    if (changed) this._paths.set(next);
  }
}
