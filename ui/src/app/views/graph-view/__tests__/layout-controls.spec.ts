/**
 * The layout catalogue itself: which algorithms exist, which one a map
 * opens with, the menu order, and the two gap scales.
 *
 * These are closed catalogues that several surfaces read at once (the
 * toolbar popover renders `LAYOUT_ALGORITHMS` verbatim, the preferences
 * service validates stored values against it, the layout dispatcher
 * branches on the literals, and the i18n catalogue supplies a label per
 * entry). Nothing recomputes any of that, so a value added in one place
 * and missed in another only shows up as a broken menu at runtime.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAYOUT_ALGORITHM,
  DEFAULT_LAYOUT_SPACING,
  FILESYSTEM_SPACING_VALUES,
  LAYOUT_ALGORITHMS,
  LAYOUT_SPACINGS,
  LAYOUT_SPACING_VALUES,
  algorithmUsesDirection,
  algorithmUsesSpacing,
  isFilesystemAlgorithm,
  isLayoutAlgorithm,
} from '../layout-controls';
import { GRAPH_VIEW_TEXTS } from '../../../../i18n/graph-view.texts';

describe('layout algorithm catalogue', () => {
  it('opens a fresh map on the compact filesystem layout', () => {
    expect(DEFAULT_LAYOUT_ALGORITHM).toBe('filesystem-compact');
    expect(LAYOUT_ALGORITHMS).toContain(DEFAULT_LAYOUT_ALGORITHM);
  });

  it('lists the default first, with its filesystem sibling next to it', () => {
    // The popover renders this array as-is, so order IS the UI.
    expect(LAYOUT_ALGORITHMS[0]).toBe(DEFAULT_LAYOUT_ALGORITHM);
    expect(LAYOUT_ALGORITHMS.slice(0, 2).every(isFilesystemAlgorithm)).toBe(true);
  });

  it('carries a label for every algorithm it offers', () => {
    // A new entry with no label renders an empty menu row.
    const labels = GRAPH_VIEW_TEXTS.layout.algorithm.options;
    for (const algorithm of LAYOUT_ALGORITHMS) {
      expect(labels[algorithm]?.label, algorithm).toBeTruthy();
    }
  });

  it('accepts every catalogue value and rejects anything else', () => {
    for (const algorithm of LAYOUT_ALGORITHMS) expect(isLayoutAlgorithm(algorithm)).toBe(true);
    // `tight-tree` was deliberately dropped from the catalogue; a value
    // stored by an older build must fail the guard so the reader falls
    // back to the default rather than feeding dagre an unknown ranker.
    expect(isLayoutAlgorithm('tight-tree')).toBe(false);
    expect(isLayoutAlgorithm('')).toBe(false);
    expect(isLayoutAlgorithm(undefined)).toBe(false);
  });

  it('withholds the direction control from the layouts that own their axes', () => {
    expect(algorithmUsesDirection('filesystem')).toBe(false);
    expect(algorithmUsesDirection('filesystem-compact')).toBe(false);
    expect(algorithmUsesDirection('force')).toBe(false);
    expect(algorithmUsesDirection('network-simplex')).toBe(true);
    expect(algorithmUsesDirection('longest-path')).toBe(true);
  });

  it('keeps the spacing control live for everything but the force simulation', () => {
    // The filesystem layouts read the gap numbers directly, so dimming
    // the control for them would strand a knob that does work.
    expect(algorithmUsesSpacing('filesystem')).toBe(true);
    expect(algorithmUsesSpacing('filesystem-compact')).toBe(true);
    expect(algorithmUsesSpacing('force')).toBe(false);
  });
});

describe('spacing scales', () => {
  it('gives the filesystem layouts tighter gaps than dagre at every tier', () => {
    // They draw no edges, so they have no routing clearance to reserve.
    for (const tier of LAYOUT_SPACINGS) {
      expect(FILESYSTEM_SPACING_VALUES[tier].nodeGap, tier).toBeLessThan(
        LAYOUT_SPACING_VALUES[tier].nodeGap,
      );
      expect(FILESYSTEM_SPACING_VALUES[tier].layerGap, tier).toBeLessThan(
        LAYOUT_SPACING_VALUES[tier].layerGap,
      );
    }
  });

  it('keeps both scales monotonic, so the tier the operator picks still means something', () => {
    for (const scale of [LAYOUT_SPACING_VALUES, FILESYSTEM_SPACING_VALUES]) {
      expect(scale.compact.nodeGap).toBeLessThan(scale.normal.nodeGap);
      expect(scale.normal.nodeGap).toBeLessThan(scale.spacious.nodeGap);
      expect(scale.compact.layerGap).toBeLessThan(scale.normal.layerGap);
      expect(scale.normal.layerGap).toBeLessThan(scale.spacious.layerGap);
    }
    expect(FILESYSTEM_SPACING_VALUES.compact.folderGap).toBeLessThan(
      FILESYSTEM_SPACING_VALUES.normal.folderGap,
    );
    expect(FILESYSTEM_SPACING_VALUES.normal.folderGap).toBeLessThan(
      FILESYSTEM_SPACING_VALUES.spacious.folderGap,
    );
  });

  it('separates folders more than it separates files inside one', () => {
    // The boundary between two folders is `nodeGap + folderGap`, so it
    // is always the wider of the two. If a future retune inverted that,
    // the column would read as one undifferentiated run and the folder
    // grouping, the whole point of these layouts, would stop being
    // visible.
    for (const tier of LAYOUT_SPACINGS) {
      const { nodeGap, folderGap } = FILESYSTEM_SPACING_VALUES[tier];
      expect(folderGap, tier).toBeGreaterThan(0);
      expect(nodeGap + folderGap, tier).toBeGreaterThan(nodeGap);
    }
  });

  it('covers every tier in both scales', () => {
    for (const tier of LAYOUT_SPACINGS) {
      expect(LAYOUT_SPACING_VALUES[tier], tier).toBeDefined();
      expect(FILESYSTEM_SPACING_VALUES[tier], tier).toBeDefined();
    }
    expect(LAYOUT_SPACINGS).toContain(DEFAULT_LAYOUT_SPACING);
  });
});
