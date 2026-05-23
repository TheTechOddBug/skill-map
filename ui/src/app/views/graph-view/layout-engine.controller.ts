/**
 * Layout-engine controller for `<sm-graph-view>`.
 *
 * Owns the async layout effect: runs dagre / d3-force when the topology
 * or layout preferences change, dedupes via a topology+preferences
 * cache key, and signals when a preference-driven re-layout completed
 * (so the host can drop user-pinned drag positions + refit the
 * viewport).
 *
 * Extracted from `graph-view.ts` so the cache-key bookkeeping
 * (`lastLayoutKey` / `lastPreferencesKey`) lives next to the effect
 * that consumes it, not inside an unrelated constructor block.
 *
 * The engine call is deferred to a microtask via
 * `Promise.resolve().then(...)` so the synchronous prelude of
 * `DagreLayoutEngine.calculate()` (which builds the graphlib graph and
 * may touch Foblex internals) runs OUTSIDE this effect's reactive
 * context. Inlining the call subscribes the effect to any signal
 * Foblex reads, producing spurious re-fires on unrelated state
 * changes.
 */

import { effect } from '@angular/core';
import type { Signal } from '@angular/core';
import type { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import type { INodeView } from '../../../models/node';
import {
  computeDagreLayout,
  computeForceLayoutPositions,
  topologyFingerprint,
  type IPoint,
  type ITopology,
} from './graph-layout';
import type {
  TLayoutAlgorithm,
  TLayoutDirection,
  TLayoutSpacing,
} from './layout-controls';

export interface ILayoutPreferences {
  readonly algorithm: TLayoutAlgorithm;
  readonly direction: TLayoutDirection;
  readonly spacing: TLayoutSpacing;
}

export interface ILayoutEngineConfig {
  /** Loaded node set; topology fingerprint is computed from it + edges. */
  nodes: Signal<readonly INodeView[]>;
  /** Topology signal (`{ nodes, edges }`). */
  topology: Signal<ITopology>;
  /** Layout preferences signal (algorithm + direction + spacing). */
  preferences: Signal<ILayoutPreferences>;
  /** Dagre engine instance, provided by the host so the controller stays Foblex-agnostic at the signature. */
  dagreLayout: DagreLayoutEngine;
  /** Fired with the resolved positions on every successful layout cycle. */
  onPositions: (positions: Map<string, IPoint>) => void;
  /** Fired with a monotonic timestamp so the perf HUD can render "layout computed at". */
  onTimestamp: (now: number) => void;
  /**
   * Fired ONLY when the preference tuple (algorithm/direction/spacing)
   * changed on this cycle. The host uses it to drop user-pinned drag
   * positions and refit the viewport to the new bounding box.
   */
  onPreferencesChanged: () => void;
}

export function setupLayoutEngine(config: ILayoutEngineConfig): {
  readonly layoutEffect: ReturnType<typeof effect>;
} {
  let lastLayoutKey = '';
  let lastPreferencesKey = '';
  const layoutEffect = effect(() => {
    const nodes = config.nodes();
    const topology = config.topology();
    const preferences = config.preferences();
    if (nodes.length === 0) return;

    const topologyKey = topologyFingerprint([...nodes], topology.edges);
    const preferencesKey =
      `${preferences.algorithm}|${preferences.direction}|${preferences.spacing}`;
    const cacheKey = `${topologyKey}|${preferencesKey}`;
    if (cacheKey === lastLayoutKey) return;
    const preferencesChanged =
      lastPreferencesKey !== '' && lastPreferencesKey !== preferencesKey;
    lastLayoutKey = cacheKey;
    lastPreferencesKey = preferencesKey;

    // Dispatch on algorithm: 'force' goes to our local d3-force helper
    // (sync, wrap in Promise.resolve so the effect's await chain is
    // uniform), the rest go to Foblex's dagre engine.
    const layoutPromise =
      preferences.algorithm === 'force'
        ? Promise.resolve(computeForceLayoutPositions([...nodes], topology.edges))
        : Promise.resolve().then(() =>
            computeDagreLayout(config.dagreLayout, [...nodes], topology.edges, preferences),
          );

    void layoutPromise
      .then((positions) => {
        config.onPositions(positions);
        config.onTimestamp(performance.now());
        if (preferencesChanged) config.onPreferencesChanged();
      })
      .catch((err) => {
        // Swallow + log: a layout failure (e.g. dagre CJS interop
        // missing in tests) must not crash the graph view. The
        // previous positions stay; the user can still pan, drag, and
        // select cards.
        // eslint-disable-next-line no-console -- developer log
        console.error('[graph-view] layout failed:', err);
      });
  });

  return { layoutEffect };
}
