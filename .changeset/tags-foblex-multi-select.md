---
"@skill-map/cli": minor
---

Tags · click-to-multi-select via Foblex Flow's native selection.

Replaces the reverted filter / fade approach. Clicking a tag chip in the inspector annotations panel computes every node whose `frontmatter.tags` ∪ `sidecar.annotations.tags` carries the tag and feeds them to `FFlowComponent.select(paths, [])`. Foblex paints the matching nodes with `.f-selected` on the host element; the visual halo lives outside the existing single-focus selection ring so both can coexist on the same card.

**Why this approach over the previous fade-out**

The previous filter-driven fade collided with the selection-driven adjacency dim — both used the same `.sm-gnode--dimmed` class, so combining "selected node + adjacency-dim + tag-filter" looked identical to "selected node + adjacency-dim". The new design uses a separate visual layer (Foblex's `.f-selected` host class) that does NOT inherit opacity-dim semantics; the multi-select halo reads as "highlighted across the graph" without competing for the dim channel.

**Surface changes**

- `<sm-annotations-panel>` chips become `role="button"` with `(click) / (keydown.enter) / (keydown.space)` → emits `(tagClick)` carrying the tag string. Tooltips dropped (the chip's `--author` / `--user` outline already conveys attribution). The panel renders the Taxonomy section even without a sidecar overlay (when `frontmatter.tags` is non-empty) so frontmatter-only nodes (`GEMINI.md`, `README.md`, the Gemini agents / skills) surface their author tags too.
- `<sm-node-card>` tag row paints dual-source — author chips outlined in primary, user chips filled — but stays read-only at this surface (clicks live on the inspector chip). The `tagChips` computed reads `frontmatter.tags` first then `sidecar.annotations.tags`, with legacy `metadata.tags` as the user-side fallback.
- `<app-inspector-view>` forwards `(tagClick)` through a new `(tagSelect)` output. Decouples the panel from the graph: standalone-mode hosts can ignore it; the graph view in embedded mode wires it to Foblex's selection API.
- `<app-graph-view>` adds `<f-selection-area />` inside `<f-flow>` so Shift+drag rectangle multi-select works natively. Also adds `flow.select(paths, [])` driven by the new `onTagSelect` handler. `activeTagSelection: signal<string | null>` tracks the active tag for toggle (clicking the chip whose tag is already active calls `flow.clearSelection()`).
- `isDimmed` / `isEdgeDimmed` short-circuit to `false` while `activeTagSelection !== null` — the multi-select halo is the dominant visual then; stacking opacity 0.25 on top would make matching nodes read "selected but ghosted".
- `graph-view.css` paints `.sm-gnode-host.f-selected` with a 3px primary ring on the inner card + a soft drop-shadow on the host. Composes with the existing `.sm-gnode--selected` (single-focus) ring instead of replacing it — a node that's both single-focused AND in the multi-select set carries both rings.
- `inspector-view.html` annotations card gate widens from `n.sidecar?.present` to `n.sidecar?.present || authorTags().length > 0` so the card stays visible for frontmatter-only tag-bearing nodes.

**Behaviour summary**

- Click node body → panel opens, single-focus selection, adjacency-dim hides non-neighbours.
- Click tag chip in panel → multi-select halo on every node carrying the tag (toggle: same chip clears). Adjacency-dim is **suspended** while the tag selection is active. Panel stays open.
- Shift + drag on canvas → native rectangle multi-select via `<f-selection-area />`.
- Click another tag → swap; click same tag → clear.

**Out of scope (next iteration)**

- Zoom-to-selection on tag click and zoom-restore on clear — the Architect explicitly flagged this as the next step; bookmarked for a follow-up patch.
- List view multi-select equivalent — tags on the list view stay attribute-only for now.
- Multi-tag composition (AND / OR) — single-tag covers the demo.

**Fixture refresh** (`fixtures/local-scope/`): every `.md` now declares author tags (3-5 each, distributed for overlap). 32 distinct tags, 58 instances across 11 nodes — `gemini`×4, `review`×4, `quality`×3+1, `angular`×2+2, `frontend`×2+2 give multi-node match sets you can see at a glance. Sidecars of the five tagged-on-author nodes were re-bumped via `sm bump --pending` so identity hashes match.

**Side fix**: `context/view-contributions.md` drops a stale plan path that no longer exists on disk.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
