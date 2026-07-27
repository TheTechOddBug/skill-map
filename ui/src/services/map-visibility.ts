import { Injectable, computed, effect, signal } from '@angular/core';

import {
  applySetSubtree,
  effectiveState,
  overrideMapsEqual,
  type TOverrideMap,
  type TVisibilityOverride,
} from './map-overrides';
import { readStoredOverrides, writeStoredOverrides } from './map-visibility.storage';

/**
 * Tri-state of a folder's subtree on the map: `all` when every node
 * under it is visible, `none` when none is, `some` when mixed. Computed
 * by the files-view over the tree walk; not derived here.
 */
export type TFolderVisibility = 'all' | 'none' | 'some';

/** True when at least one path in `validPaths` is a descendant of `prefix`. */
function hasDescendant(validPaths: ReadonlySet<string>, prefix: string): boolean {
  const needle = `${prefix}/`;
  for (const p of validPaths) if (p.startsWith(needle)) return true;
  return false;
}

/**
 * Shared, project-local store for the MAP scope, the deviation model of
 * `spec/cli-contract.md` §Map scope overrides.
 *
 * Holds the OVERRIDE map (`path -> include | exclude`, root = `''`).
 * The default is the EMPTY map: everything visible, every rail checkbox
 * checked. Unchecking a row writes an exclude override for its subtree;
 * checking writes an include; a row whose toggle lands back on what it
 * would inherit anyway deletes its override instead (`applySetSubtree`
 * keeps the map canonical, so `isActive` is exact). Effective state is
 * nearest-ancestor-wins, evaluated SERVER-SIDE for the graph: the
 * loader compiles this map onto `/api/branch` (`path=` / `exclude=` /
 * `excludeRoot=`) and the server returns the capped scoped set, which
 * the graph renders directly.
 *
 * Persisted to `localStorage` (survives a reload) via an effect,
 * mirroring the `nodePositions` / `collapsed` discipline; the legacy
 * inclusion-whitelist entry migrates on first read. Mutations are
 * immutable map swaps so signal consumers re-run on identity change.
 */
@Injectable({ providedIn: 'root' })
export class MapVisibilityService {
  private readonly _overrides = signal<TOverrideMap>(readStoredOverrides());

  /** The override map (root = `''`). Empty == everything visible. */
  readonly overrides = this._overrides.asReadonly();

  /** True when any override is active (the map deviates from show-all). */
  readonly isActive = computed(() => this._overrides().size > 0);

  constructor() {
    effect(() => writeStoredOverrides(this._overrides()));
  }

  /**
   * Effective visibility of a path under the current overrides
   * (nearest-ancestor-wins; no override = included). Reactive: reads
   * the overrides signal, so `computed` consumers re-run on change.
   */
  effectiveState(path: string): TVisibilityOverride {
    return effectiveState(this._overrides(), path);
  }

  /**
   * THE toggle primitive: force `path`'s subtree to `desired`
   * (`path === ''` = the whole corpus, the master checkbox). Drops the
   * subtree's own overrides first and writes only a non-redundant
   * override, so the map stays canonical.
   */
  setSubtree(path: string, desired: TVisibilityOverride): void {
    this._overrides.set(applySetSubtree(this._overrides(), path, desired));
  }

  /**
   * Show ONLY `paths` (the tag-selection / isolate apply primitive):
   * root-exclude plus one include per path. An empty iterable clears to
   * show-all, preserving the historical `setOnly([])` meaning.
   */
  setOnly(paths: Iterable<string>): void {
    const next = new Map<string, TVisibilityOverride>();
    for (const path of paths) {
      if (path.length > 0) next.set(path, 'include');
    }
    if (next.size > 0) next.set('', 'exclude');
    this._overrides.set(next);
  }

  /** Restore a snapshot verbatim (tag-selection / isolate toggle-back). */
  setOverrides(overrides: TOverrideMap): void {
    this._overrides.set(new Map(overrides));
  }

  // --- isolate toggle bookkeeping -----------------------------------------
  // In-memory only (NOT persisted): a reload starts a fresh isolate cycle,
  // which is the sane default. The snapshot holds the override map as it was
  // right before the last isolate; the origin + result let a re-isolate of the
  // SAME node decide whether the map is still showing exactly what that isolate
  // produced (strict toggle) or whether the user edited curation in between.
  private _isolateOrigin: string | null = null;
  private _isolateSnapshot: TOverrideMap | null = null;
  private _isolateResult: TOverrideMap | null = null;

  private resetIsolateMemory(): void {
    this._isolateOrigin = null;
    this._isolateSnapshot = null;
    this._isolateResult = null;
  }

  /**
   * Isolate gesture with toggle-back. The first call snapshots the current
   * override map, then narrows the map to `neighborhood`. A second call for
   * the SAME `origin`, while the map is still showing exactly that
   * neighborhood, restores the snapshot (the visibility from before the
   * isolate). Any other call (a different `origin`, or the curation was edited
   * in between so the live map no longer matches) starts a fresh isolate and
   * re-snapshots. Returns the action taken so the caller can keep node
   * selection in sync (`isolated` selects the origin; `restored` leaves
   * selection untouched).
   *
   * The neighborhood itself is computed by the graph view, which owns the link
   * graph, keeping this service decoupled from topology.
   */
  isolate(origin: string, neighborhood: Iterable<string>): 'isolated' | 'restored' {
    const applied = new Map<string, TVisibilityOverride>();
    for (const path of neighborhood) {
      if (path.length > 0) applied.set(path, 'include');
    }
    if (applied.size > 0) applied.set('', 'exclude');
    const isToggleBack =
      this._isolateOrigin === origin &&
      this._isolateResult !== null &&
      overrideMapsEqual(this._overrides(), this._isolateResult);
    if (isToggleBack) {
      const snapshot = this._isolateSnapshot ?? new Map<string, TVisibilityOverride>();
      this.resetIsolateMemory();
      this.setOverrides(snapshot);
      return 'restored';
    }
    this._isolateSnapshot = this._overrides();
    this._isolateOrigin = origin;
    this._isolateResult = applied;
    this._overrides.set(applied);
    return 'isolated';
  }

  /** Clear every override; the map returns to "show all". */
  clear(): void {
    if (this._overrides().size === 0) return;
    this._overrides.set(new Map());
  }

  /**
   * Drop any override whose path no longer exists after a re-scan. An
   * override key stays valid when it is the root, itself a node path,
   * or a folder prefix that still has at least one descendant node
   * (folder prefixes are never node paths themselves). If pruning
   * leaves a scope where nothing can be visible (root excluded with no
   * surviving include), everything clears: the map falls back to
   * "show all", today's failsafe for a selection that died wholesale.
   */
  prune(validPaths: ReadonlySet<string>): void {
    const current = this._overrides();
    if (current.size === 0) return;
    let changed = false;
    const next = new Map<string, TVisibilityOverride>();
    for (const [key, kind] of current) {
      if (key === '' || validPaths.has(key) || hasDescendant(validPaths, key)) {
        next.set(key, kind);
      } else {
        changed = true;
      }
    }
    if (!changed) return;
    const nothingVisible =
      next.get('') === 'exclude' && ![...next.values()].includes('include');
    this._overrides.set(nothingVisible ? new Map() : next);
  }
}
