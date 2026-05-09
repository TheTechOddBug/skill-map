---
"@skill-map/cli": minor
---

Tags · click filters by union (any-source), filter takes precedence over selection focus, tooltips dropped.

Three follow-up fixes after the click-on-tag UX (`44a3db2`, `2b8da97`) on the Architect's first real-world use.

**1) Click filters across both sources by default (`'any'` mode)**

Clicking a tag chip — in either the inspector annotations panel or the graph card — now sets the filter to `(tag, 'any')`, matching every node carrying the tag regardless of `byAuthor` / `byUser` attribution. Same default as `sm list --tag <name>`.

The chip's `--author` / `--user` variant is now purely **visual attribution**; it does NOT narrow the click semantic. Both author and user chips for the same tag light up when the active filter targets that tag (`isActiveTag` honours `'any'` source as a wildcard match).

Narrow-source filters (`'author'` / `'user'`) are still reachable via:
- URL deep links — `?tag=foo&tag-source=user` ingests as a narrow filter and survives the round-trip.
- Future right-click / modifier flow — once a real need appears.

`FilterStoreService.toggleTagFilter(tag, source)` widened from `'author' | 'user'` to `'author' | 'user' | 'any'`. The narrow modes still work for URL ingestion and tests.

**2) Filter takes precedence over selection-driven dim**

When a node was selected (inspector panel open), the existing adjacency dim faded everything except the selected node + its neighbours. Adding a tag filter on top contributed nothing visible — the filter dim and the selection dim used the same `.sm-gnode--dimmed` class with the same opacity, and the selection had already dimmed most of the graph. The Architect's symptom: "no veo que filtre todos los que tengan el mismo tag".

Fix: while any filter is active (`filters.isActive() === true`), the selection-driven adjacency dim is **suspended**. Only the filter-driven dim applies. The selected node still wins (never dimmed) and keeps its selection ring; matching nodes everywhere else stay vivid; non-matching nodes fade. The filter signal is now visible across the whole graph.

Edges follow the same rule: filter active → dim iff either endpoint is filter-dimmed; filter inactive → fall back to "edge doesn't touch the selected node" dim.

**3) Drop tag-source tooltips**

The author/user attribution tooltip on each chip was noise — the chip's visual variant (outlined vs filled) already carries the attribution. Removed `[pTooltip]` from both author and user chips and dropped the unused `tagSourceAuthorTooltip` / `tagSourceUserTooltip` strings from the i18n catalog. `TooltipModule` stays imported because the relations chips still use `pTooltip` for broken-ref hints.

**Surface changes**

- `ui/src/services/filter-store.ts` — `toggleTagFilter` widened to accept `'any'`; doc updated.
- `ui/src/app/components/annotations-panel/{annotations-panel.ts, annotations-panel.html}` — `tagClick` emits `'any'`, `activeTagFilter` input widened to `'any'`, `isActiveTag` treats `'any'` as wildcard. Tooltips dropped.
- `ui/src/app/components/node-card/{node-card.ts, node-card.html}` — same: emit `'any'`, widen `activeTagFilter`.
- `ui/src/app/views/inspector-view/inspector-view.ts` — `onTagClick` accepts `'any'`; `activeTagFilter` computed forwards the filter store value as-is (no longer drops `'any'`).
- `ui/src/app/views/graph-view/graph-view.ts` — `isDimmed` and `isEdgeDimmed` short-circuit to filter-only when `filters.isActive()`. `onTagClick` accepts `'any'`.
- `ui/src/i18n/annotations-panel.texts.ts` — drop the two unused tooltip strings.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
