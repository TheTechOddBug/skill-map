---
'@skill-map/cli': minor
---

Replace the graph view's hand-tuned d3-force layout with an
algorithm dispatcher and surface the knobs through three new
popovers in the bottom toolbar (next to the zoom controls). Two
engines feed the dispatcher: Foblex's `@foblex/flow-dagre-layout`
plugin (versions pinned to 18.5.0, matches the installed
`@foblex/flow`) for the layered `Balanced` and `Stretched` modes,
and the existing d3-force simulation kept around as the `Organic`
mode for users who want a physics-based arrangement without a
fixed flow direction.

`GraphPreferencesService` grows three new signals
(`layoutAlgorithm`, `layoutDirection`, `layoutSpacing`) persisted
under their own `sm.graph.*` localStorage keys. Each signal has
a closed catalogue + type-guard in
`ui/src/app/views/graph-view/layout-controls.ts`, so stale values
from older versions fail validation and fall back to defaults
without crashing the dagre call. A small predicate pair
(`algorithmUsesDirection` / `algorithmUsesSpacing`) keeps the
direction + spacing buttons in sync with the active engine,
they grey out when `Organic` is selected because d3-force ignores
those numbers.

`graph-layout.ts` is reshaped around two pure helpers
(`resolveTopology` builds the indexed maps + resolved edge set,
`topologyFingerprint` keys the cache) and two engine bindings
(`computeDagreLayout` async, `computeForceLayoutPositions` sync).
The graph view's async layout effect picks one engine per the
active algorithm, holds the result in a `layoutPositions` signal,
and clears the user-pinned `nodePositions` on every preference
change so the reseed flows through the existing reconcile
effect. Connections fall back to Foblex's `CALCULATE` mode under
`Organic` so arrows auto-orient against the un-directed cloud.

Toolbar buttons render with dynamic icons: the direction button
swaps `pi-arrow-{down|up|right|left}` to mirror the active
direction; the spacing button swaps
`pi-th-large` / `pi-bars` / `pi-expand` to mirror the active
preset. Each popover renders an icon-only row so the catalogue
reads at a glance. After a preference-driven relayout the
viewport tweens to the new bounding box via a double-rAF +
`fitToScreen(..., true)` so the camera follows the new
arrangement instead of leaving the user staring at empty canvas.

`tight-tree` (dagre's third ranker) and the layout section that
used to live in `Settings → General` are removed: `tight-tree`
converges to the same layout as `network-simplex` on our
typical small / mostly-hierarchical graphs and offered no
visible payoff, while the Settings rows duplicated the toolbar
controls without adding value. Stale localStorage values are
discarded by the guard on next read.

## User-facing

The graph view now lets you pick the layout algorithm
(**Balanced**, **Stretched** or **Organic**), direction
(top/bottom/left/right) and spacing (compact / normal /
spacious) from new buttons in the bottom toolbar. The matching
section in Settings → General was removed.
