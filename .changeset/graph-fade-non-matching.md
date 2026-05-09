---
"@skill-map/cli": minor
---

Graph view · fade non-matching nodes instead of dropping them.

Until now, an active filter (search, kinds, stabilities, has-issues, stale-only, favorites-only, tag) **structurally** removed non-matching nodes from the graph render. Toggling a filter would shrink and reflow the rendered count; coming back from a narrow filter to "all" would expand the graph again. The spatial topology was unstable at filter-toggle time, even though the underlying force-layout cache always knew the full positions.

The graph view now renders the **full** set of nodes regardless of filter state, and **fades** the ones the active filter excludes. The spatial topology stays stable; toggling a filter is a visual highlight pass, not a layout pass.

**Behaviour**

- All nodes always project through `projectVisible(layout, allPaths, …)`. The full d3-force layout keeps driving positions, with manual drag overrides on top.
- A new `filterDimmedSet` computed (paths excluded by the active filter) is unioned with the existing selection-driven dim. A node is dimmed when EITHER condition holds:
  - selection is active and this node isn't its neighbour (unchanged from before);
  - the active filter excludes this node (new).
- Edges follow the same union: an edge is dimmed if either endpoint is filter-dimmed, or if a selection is active and the edge doesn't touch it.
- The selected node is **never** dimmed — even if the filter excludes it. Useful flow: filter narrows away from a previously-selected node ⇒ the panel still works; you can act on it via the inspector or click adjacent neighbours.
- Perf HUD: `visibleCount()` now reads "matching the active filter" (zero filter active ⇒ matching = total), so the HUD's "X of Y" label keeps the same semantic. `totalCount()` is the kernel total. `edgeCount()` counts every projected edge (the graph projects them all now).
- Initial fit-to-screen reacts to `loader.nodes()`, not the (now-removed) `visibleNodes`. Filter toggles never trigger a re-fit (they didn't trigger one before either; the comment in the effect is updated to point at `filterDimmedSet`).

**Surface changes** (`ui/src/app/views/graph-view/graph-view.ts`)

- Removed the private `visibleNodes` computed; replaced by `matchingNodes` (filter-passing list) plus `filterDimmedSet` (the inverse — dimmed paths).
- `graph()` projects against the full path set (no filter applied at projection time).
- `isDimmed(id)` and `isEdgeDimmed(edge)` now OR the filter-driven dim with the selection-driven dim.
- Initial-fit `effect` reacts to `loader.nodes()` directly.

**Tests** (`ui/src/app/views/graph-view/graph-view.spec.ts`)

- Non-matching nodes stay in `graph().nodes` and are marked `isDimmed`.
- `visibleCount` reads matching count, `totalCount` reads kernel total.
- The selected node is not dimmed even when the filter excludes it.
- `filters.reset()` clears all filter dimming.

**List view & elsewhere** — unchanged. Filters still drop rows from the list (fading rows would be weirder UX). The graph fade is a graph-only treatment for the spatial topology stability win.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
