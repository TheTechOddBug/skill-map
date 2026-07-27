/**
 * Tag-selection state machine for the graph view. Owns the
 * `activeTagSelection` signal and a snapshot of the map-visibility
 * curation taken before the first tag activation, so toggling the tag
 * off lands the user back on whatever they were looking at.
 *
 * Clicking a tag CURATES the map down to the nodes carrying that tag:
 * `mapVisibility.setOnly(taggedPaths)` hides every other node (same
 * mechanism the rail's isolate gesture uses). Unlike the rail gestures, a
 * tag curation deliberately does NOT reframe the camera: the graph view's
 * curation re-fit effect detects the tag-driven change (via the
 * `activeTagSelection` transition) and skips the glide, so the operator
 * keeps looking at the card they clicked. This controller stays a pure
 * visibility state machine with no viewport / Foblex coupling.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph rendering + node-drag + filter concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a small handle the component captures in its constructor.
 */

import { signal, type Signal } from '@angular/core';

import type { INodeView } from '../../../models/node';
import type { TOverrideMap } from '../../../services/map-overrides';
import type { MapVisibilityService } from '../../../services/map-visibility';
import { nodeHasTag } from './graph-view.utils';

export interface ITagSelectionConfig {
  /** Source for the full node list (tagged-path resolution). */
  readonly nodes: Signal<INodeView[]>;
  /** Shared map-visibility curation store the tag filter drives. */
  readonly mapVisibility: Pick<
    MapVisibilityService,
    'overrides' | 'setOnly' | 'setOverrides'
  >;
}

export interface ITagSelectionHandle {
  readonly activeTagSelection: Signal<string | null>;
  /**
   * Tag chip click forwarded from the inspector header. Curates the map
   * to every node carrying `tag` (the rest hide); clicking the active
   * tag again restores the pre-tag curation.
   */
  onTagSelect: (tag: string) => void;
}

export function setupTagSelection(config: ITagSelectionConfig): ITagSelectionHandle {
  const activeTagSelection = signal<string | null>(null);
  // Curation in effect before the first tag activation. Restored on
  // toggle-off so the user returns to their prior view (a manual
  // checkbox curation, an isolate scope, or "show all" == empty map).
  // Snapshotted once; tag-to-tag swaps do not overwrite it.
  let curationBeforeTag: TOverrideMap | null = null;

  const restoreCuration = (): void => {
    if (curationBeforeTag === null) return;
    const saved = curationBeforeTag;
    curationBeforeTag = null;
    // An empty saved map means "show all".
    config.mapVisibility.setOverrides(saved);
  };

  const onTagSelect = (tag: string): void => {
    if (activeTagSelection() === tag) {
      activeTagSelection.set(null);
      restoreCuration();
      return;
    }
    const paths = config
      .nodes()
      .filter((n) => nodeHasTag(n, tag))
      .map((n) => n.path);
    if (paths.length === 0) {
      activeTagSelection.set(null);
      restoreCuration();
      return;
    }
    if (curationBeforeTag === null) {
      curationBeforeTag = new Map(config.mapVisibility.overrides());
    }
    config.mapVisibility.setOnly(paths);
    activeTagSelection.set(tag);
  };

  return { activeTagSelection, onTagSelect };
}
