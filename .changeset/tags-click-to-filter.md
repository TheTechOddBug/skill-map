---
"@skill-map/cli": minor
---

Tags · click-on-tag → filter the graph and list views.

Tag chips in the annotations panel are now interactive. Clicking a chip toggles a filter that propagates through `FilterStoreService` to every view that reads it (graph, list, faceted surfaces). Single-tag UX: clicking the same chip clears the filter; clicking a different chip swaps; the filter bar surfaces the active filter as a removable chip with an "x" to clear.

**Wire shape**

- `INodeApi.tags` (Phase 4 of the tag system) is now passed through the projection layer (`projectNode` in `collection-loader.ts`) into `INodeView.tags = { byAuthor, byUser }`. Both the annotations panel and the filter store read from the same source.

**Filter store** (`ui/src/services/filter-store.ts`)

- New `tagFilter` signal: `{ tag: string; source: 'author' | 'user' | 'any' } | null`. Default `null`.
- `toggleTagFilter(tag, source)` — sets the filter on first click of a chip, swaps when a different `(tag, source)` is clicked, clears when the same chip is clicked again.
- `setTagFilter(filter)` — programmatic setter (URL ingestion, tests).
- `clearTagFilter()` — convenience clear used by the filter bar's "x".
- `reset()` clears the tag filter alongside the rest.
- `isActive` derived signal accounts for `tagFilter !== null`.
- `apply(nodes)` honours the filter: `'author'` matches `node.tags.byAuthor`; `'user'` matches `node.tags.byUser`; `'any'` matches the union. Nodes without a `tags` projection (static fixtures, legacy callers) drop out — absence is real, not "unknown".

**Annotations panel** (`<sm-annotations-panel>`)

- Each tag chip is now a focusable, role="button" element with click + Enter / Space keyboard activation. Emits `tagClick` with `{ tag, source }`.
- New `activeTagFilter` input — when set, the matching chip renders in a "selected" state (solid primary fill + ring) so the user sees which chip drives the current filter.
- New CSS rules `.ann-panel__chip--active` for the selected state and hover / focus-visible affordances on the interactive chips.

**Inspector view**

- Injects `FilterStoreService`; new `activeTagFilter` computed signal projects the panel-friendly subset (`'any'` mode is for programmatic / URL flows and doesn't render an active chip).
- `onTagClick(event)` handler routes the panel's emission to `filters.toggleTagFilter`.

**Filter bar**

- Renders an active tag-filter chip with the `(author)` / `(you)` attribution (or unmarked for `'any'`). The chip's "x" calls `clearTagFilter`.
- New `tagFilterLabel` formatter in the i18n catalog.

**Tests**

- `ui/src/services/filter-store.spec.ts` — new spec covering the toggle / swap / clear lifecycle and the dual-source `apply()` predicate (author / user / any modes; missing-projection drop).

**Out of scope**

- Multi-tag composition (AND / OR). Single-tag covers the click-from-chip UX; revisit if multi-tag faceting becomes a real need.
- URL persistence (`?tag=foo&tag-source=user`). The `setTagFilter` setter is ready; the URL sync layer wires up in a separate plan.
- Graph view "fade out non-matching nodes" animation. Today nodes are filtered structurally; the visual effect inherits from how the graph layout consumes `apply(nodes)`.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
