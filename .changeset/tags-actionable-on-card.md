---
"@skill-map/cli": minor
---

Tags · click-to-filter on the graph card + cursor pointer affordance fix on inspector chips.

Two related polish passes on the click-on-tag UX (`44a3db2`).

**1) Inspector chip cursor pointer fix**

The annotations-panel chip CSS was using `:host ::ng-deep .ann-panel__chip--user .p-chip` (descendant selector). PrimeNG ≥ 21 merges `[styleClass]` onto the same element that carries `.p-chip` (host class binding `cn(cx('root'), styleClass)`), so `.ann-panel__chip--user` and `.p-chip` are SIBLING classes, not nested ones — the descendant selector silently missed every chip on PrimeNG ≥ 21. Removed the `.p-chip` step from every author/user/active selector; cursor pointer + hover lift + focus-visible ring now apply correctly.

**2) Node-card chips become click-to-filter**

The graph card (`<sm-node-card>`) was rendering tags as plain `<span>` elements with no click handler. They're now `<button>` elements that mirror the inspector annotations panel:

- Source-aware: each chip carries `{ tag, source: 'author' | 'user' }`. Author chips render outlined (matching inspector), user chips render filled (default).
- Active state: `--active` modifier applies a solid primary fill + ring when the chip's `(tag, source)` matches the current filter (also `'any'` mode lights up matching chips on every card).
- Click / Enter / Space all emit a `tagClick` event with `(tag, source)`. `$event.stopPropagation()` keeps the click from also firing the card's selection handler underneath.

Source order in the projection:
- If `node.tags` is set (BFF dual-source projection), iterate `byAuthor` first, then `byUser`. A tag present in both renders TWICE (once per side) so the user can pick which side to filter on.
- Cold path (legacy fixture / static seed without `node.tags`): fall back to `sidecar.annotations.tags` / legacy `frontmatter.metadata.tags` — both treated as `'user'` since the BFF is the only source that splits frontmatter into `byAuthor`.

**Wire shape**

- `<sm-node-card>`: new `[activeTagFilter]` input, new `(tagClick)` output.
- `<app-graph-view>`: forwards `(tagClick)` to `FilterStoreService.toggleTagFilter` (same handler path the inspector uses); reads `tagFilter()` for `[activeTagFilter]`. Both surfaces share the singleton store, so a click in either lights up the matching chip on every card.

**Tests** (`ui/src/app/views/graph-view/graph-view.spec.ts`)

- `toggleTagFilter('urgent', 'user')` dims non-matching nodes (matching apply path verified end-to-end).
- Nodes whose `tags` projection is missing entirely (legacy / static fixtures) get filter-dimmed when any tag filter is active — absence is "no tags", not "tags unknown".

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
